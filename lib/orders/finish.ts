import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { getOrder } from './store'

// What happens to a finished job.
//
// A completed order had nowhere to go, so finished work was re-typed into another system. Two actions,
// deliberately independent: raise an invoice from what was already entered, and copy the piece into
// the catalog. A job can be invoiced and not archived, archived and not invoiced, or both — which is
// why they are two timestamps rather than one status.
//
// Both write defensively: if add_orders_6 has not been run, they report that instead of throwing a
// PostgREST code at the person pressing the button.

export interface FinishResult { ok: boolean; error?: string; created?: number }

const MIGRATION_HINT = 'run add_orders_6_estimates_tax_templates.sql'

/**
 * Mark the order invoiced. It creates no new record, because the invoice already exists: the same
 * order, rendered as an invoice document, from the data that was entered when the job was quoted.
 * Nothing is re-keyed — that is the whole point of the feature.
 */
export async function raiseInvoice(orderId: string): Promise<FinishResult> {
  const c = await requireActiveBusinessContext()
  if (!c) return { ok: false, error: 'Not signed in' }
  const order = await getOrder(orderId)
  if (!order || order.tenantId !== c.tenantId) return { ok: false, error: 'Order not found' }

  const db = createAdminClient()
  const { error } = await db.from('orders')
    .update({ invoiced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', orderId).eq('tenant_id', c.tenantId)
  if (error) return { ok: false, error: `Could not mark as invoiced — if this is a new install, ${MIGRATION_HINT}. (${error.message})` }

  await db.from('order_events').insert({
    tenant_id: c.tenantId, order_id: orderId, type: 'invoice_raised', actor: c.actorUserId ?? null,
  }).then(() => {}, () => {}) // the event log is a convenience; never fail the action for it
  return { ok: true }
}

/**
 * Copy the finished piece into the catalog.
 *
 * One product per line item, carrying the name, description, SKU and the price it actually sold at.
 * Quantities are ZERO on purpose: the piece has been delivered, so the business owns none of it. A
 * catalog row with stock it does not have would have the voice agent offering a customer a ring that
 * is on somebody's finger.
 *
 * status 'active' so it is findable and can be re-made or referenced; availability 'special_order'
 * because that is what a bespoke piece genuinely is.
 */
export async function archiveToInventory(orderId: string): Promise<FinishResult> {
  const c = await requireActiveBusinessContext()
  if (!c) return { ok: false, error: 'Not signed in' }
  const order = await getOrder(orderId)
  if (!order || order.tenantId !== c.tenantId) return { ok: false, error: 'Order not found' }
  if (!order.lineItems.length) return { ok: false, error: 'This order has no items to archive.' }

  const db = createAdminClient()
  const rows = order.lineItems.map((l) => ({
    tenant_id: c.tenantId,
    name: l.productName,
    sku: l.sku ?? null,
    description: [l.description, l.customSpec].filter(Boolean).join(' · ') || null,
    price: l.unitPriceCents ? l.unitPriceCents / 100 : null,
    status: 'active',
    availability_status: 'special_order',
    showroom_quantity: 0,
    warehouse_quantity: 0,
    storage_quantity: 0,
    internal_notes: `Made for order ${order.orderNumber}`,
  }))

  const { error } = await db.from('catalog_products').insert(rows)
  if (error) return { ok: false, error: `Could not archive to inventory. (${error.message})` }

  const { error: stampErr } = await db.from('orders')
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', orderId).eq('tenant_id', c.tenantId)
  if (stampErr) {
    // The products exist. Reporting success would hide that the order is not marked, and a second
    // press would duplicate them — so say what happened.
    return { ok: false, error: `Archived ${rows.length} item(s), but could not mark the order — if this is a new install, ${MIGRATION_HINT}.`, created: rows.length }
  }

  await db.from('order_events').insert({
    tenant_id: c.tenantId, order_id: orderId, type: 'archived_to_inventory', actor: c.actorUserId ?? null,
    payload: { count: rows.length },
  }).then(() => {}, () => {})

  return { ok: true, created: rows.length }
}

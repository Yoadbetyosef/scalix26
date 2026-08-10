import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { ORDER_BUCKET } from './attachments'
import { generateOrderNumber } from './order-number'
import { canManualTransition, type OrderStage } from './stages'
import type { Order, OrderLineItem, OrderEvent, OrderWithDetails, OrderInput, LineItemInput } from './types'

// Server-only Orders data access. Every call resolves the validated active tenant (requireActiveBusinessContext)
// and queries through the RLS-scoped authenticated client, so a tenant can only ever touch its own orders.
// The Orders module must be enabled for the tenant (route guards + API handlers check that separately).

export interface OrderCtx { tenantId: string; actor: string }
async function ctx(): Promise<OrderCtx | null> {
  const c = await requireActiveBusinessContext()
  if (!c) return null
  return { tenantId: c.tenantId, actor: c.actorUserId }
}

const orderRow = (r: Record<string, unknown>): Order => ({
  id: r.id as string, tenantId: r.tenant_id as string, orderNumber: r.order_number as string, contactId: (r.contact_id as string) ?? null,
  customerName: (r.customer_name as string) ?? null, customerEmail: (r.customer_email as string) ?? null, customerPhone: (r.customer_phone as string) ?? null,
  stage: r.stage as OrderStage, supplierId: (r.supplier_id as string) ?? null, factoryName: (r.factory_name as string) ?? null, factoryContactName: (r.factory_contact_name as string) ?? null, factoryEmail: (r.factory_email as string) ?? null,
  assignedEmployee: (r.assigned_employee as string) ?? null, orderDate: (r.order_date as string) ?? null, requestedCompletionDate: (r.requested_completion_date as string) ?? null, estimatedCompletionDate: (r.estimated_completion_date as string) ?? null,
  subtotalCents: Number(r.subtotal_cents ?? 0), depositCents: Number(r.deposit_cents ?? 0), balanceCents: Number(r.balance_cents ?? 0), currency: (r.currency as string) ?? 'usd',
  clientRequirements: (r.client_requirements as string) ?? null, isCustomDesign: r.is_custom_design === true,
  internalNotes: (r.internal_notes as string) ?? null, publicNotes: (r.public_notes as string) ?? null, createdBy: (r.created_by as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  // Added by add_orders_6. Read off the row rather than selected by name, so a database without the
  // migration yields undefined here instead of failing the whole query.
  deliveryProvince: (r.delivery_province as string) ?? null,
  documentTemplateId: (r.document_template_id as string) ?? null,
  invoicedAt: (r.invoiced_at as string) ?? null,
  archivedAt: (r.archived_at as string) ?? null,
})
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
const lineRow = (r: Record<string, unknown>): OrderLineItem => ({
  id: r.id as string, orderId: r.order_id as string, productName: r.product_name as string, description: (r.description as string) ?? null, sku: (r.sku as string) ?? null,
  quantity: Number(r.quantity ?? 1), unitPriceCents: Number(r.unit_price_cents ?? 0), measurements: (r.measurements as string) ?? null, color: (r.color as string) ?? null, material: (r.material as string) ?? null,
  customSpec: (r.custom_spec as string) ?? null, productRef: (r.product_ref as string) ?? null, lineTotalCents: Number(r.line_total_cents ?? 0), displayOrder: Number(r.display_order ?? 0),
  stoneQuality: (r.stone_quality as string) ?? null, stoneColor: (r.stone_color as string) ?? null, stoneOrigin: (r.stone_origin as string) ?? null, stoneType: (r.stone_type as string) ?? null,
  centerStoneShape: (r.center_stone_shape as string) ?? null, sideStoneShape: (r.side_stone_shape as string) ?? null,
  centerStoneCarat: num(r.center_stone_carat), sideStoneCaratTotal: num(r.side_stone_carat_total), metalKarat: (r.metal_karat as string) ?? null,
  certificateLab: (r.certificate_lab as string) ?? null, ringSize: (r.ring_size as string) ?? null,
  // num() rather than Number(): it preserves NULL, which here means "not recorded" and must not
  // collapse to 0. See lib/orders/types.ts.
  internalCostCents: num(r.internal_cost_cents),
})

// One place that turns a LineItemInput into its DB row — used by both create and update so the jewelry
// columns can never drift between the two paths.
const lineInsert = (tenantId: string, orderId: string, i: LineItemInput, total: number, idx: number) => ({
  tenant_id: tenantId, order_id: orderId, product_name: i.productName, description: i.description ?? null, sku: i.sku ?? null,
  quantity: i.quantity ?? 1, unit_price_cents: i.unitPriceCents ?? 0, measurements: i.measurements ?? null, color: i.color ?? null, material: i.material ?? null,
  custom_spec: i.customSpec ?? null, product_ref: i.productRef ?? null, line_total_cents: total, display_order: idx,
  stone_quality: i.stoneQuality ?? null, stone_color: i.stoneColor ?? null, stone_origin: i.stoneOrigin ?? null, stone_type: i.stoneType ?? null,
  center_stone_shape: i.centerStoneShape ?? null, side_stone_shape: i.sideStoneShape ?? null,
  center_stone_carat: i.centerStoneCarat ?? null, side_stone_carat_total: i.sideStoneCaratTotal ?? null, metal_karat: i.metalKarat ?? null,
  certificate_lab: i.certificateLab ?? null, ring_size: i.ringSize ?? null,
  internal_cost_cents: i.internalCostCents ?? null,
})
const eventRow = (r: Record<string, unknown>): OrderEvent => ({ id: r.id as string, orderId: r.order_id as string, type: r.type as string, actor: (r.actor as string) ?? null, payload: (r.payload as Record<string, unknown>) ?? null, createdAt: r.created_at as string })

export async function listOrders(): Promise<Order[]> {
  const c = await ctx(); if (!c) return []
  const sb = await createClient()
  const { data } = await sb.from('orders').select('*').eq('tenant_id', c.tenantId).order('created_at', { ascending: false })
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(orderRow)
}

/**
 * Read an order for a tenant given EXPLICITLY, with no session involved.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────
 *
 * getOrder() below resolves tenancy from ctx() — the signed-in workspace — and reads with the
 * cookie-scoped client. That is right for every owner-facing screen and WRONG for a public one: on
 * /e/[token] there is no session, so ctx() returns null, getOrder() returns null, and the page 404s on
 * a link the customer was just emailed. It did exactly that in production.
 *
 * Here tenancy is an ARGUMENT. The caller has already proved it — the share token resolved to a row
 * carrying tenant_id — so the scope is explicit rather than ambient, and the admin client is correct
 * because there is no user whose RLS could apply. The same shape getApprovalByToken already uses.
 *
 * The tenant_id filter is NOT optional decoration: it is the only thing standing between a leaked
 * order id and another tenant's data, since the admin client bypasses RLS.
 */
export async function getOrderForTenant(tenantId: string, id: string): Promise<OrderWithDetails | null> {
  const sb = createAdminClient()
  const { data } = await sb.from('orders').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!data) return null
  const [items, events] = await Promise.all([
    sb.from('order_line_items').select('*').eq('order_id', id).order('display_order'),
    sb.from('order_events').select('*').eq('order_id', id).order('created_at', { ascending: false }),
  ])
  return { ...orderRow(data as Record<string, unknown>), lineItems: ((items.data as Array<Record<string, unknown>>) ?? []).map(lineRow), events: ((events.data as Array<Record<string, unknown>>) ?? []).map(eventRow) }
}

/** The owner-facing read: tenancy from the signed-in workspace. Never use on a public route. */
export async function getOrder(id: string): Promise<OrderWithDetails | null> {
  const c = await ctx(); if (!c) return null
  return getOrderForTenant(c.tenantId, id)
}

const lineTotals = (items: LineItemInput[]) => items.map((i) => Math.round((i.quantity ?? 1) * (i.unitPriceCents ?? 0)))

export async function addEvent(orderId: string, type: string, payload: Record<string, unknown> | null, actor?: string): Promise<void> {
  const c = await ctx(); if (!c) return
  const sb = await createClient()
  await sb.from('order_events').insert({ tenant_id: c.tenantId, order_id: orderId, type, actor: actor ?? c.actor, payload })
}

export async function createOrder(input: OrderInput): Promise<Order | null> {
  const c = await ctx(); if (!c) return null
  const sb = await createClient()
  const items = input.lineItems ?? []
  const totals = lineTotals(items)
  const subtotal = totals.reduce((s, n) => s + n, 0)
  const deposit = input.depositCents ?? 0
  const orderNumber = (input.orderNumber && input.orderNumber.trim()) || generateOrderNumber()
  const { data, error } = await sb.from('orders').insert({
    tenant_id: c.tenantId, order_number: orderNumber, contact_id: input.contactId ?? null,
    customer_name: input.customerName ?? null, customer_email: input.customerEmail ?? null, customer_phone: input.customerPhone ?? null,
    stage: 'new', factory_name: input.factoryName ?? null, factory_contact_name: input.factoryContactName ?? null, factory_email: input.factoryEmail ?? null,
    assigned_employee: input.assignedEmployee ?? null, order_date: input.orderDate ?? null, requested_completion_date: input.requestedCompletionDate ?? null, estimated_completion_date: input.estimatedCompletionDate ?? null,
    subtotal_cents: subtotal, deposit_cents: deposit, balance_cents: subtotal - deposit, currency: input.currency ?? 'usd',
    client_requirements: input.clientRequirements ?? null, is_custom_design: input.isCustomDesign ?? false,
    internal_notes: input.internalNotes ?? null, public_notes: input.publicNotes ?? null, created_by: c.actor,
  }).select('*').single()
  if (error) throw new Error(error.code === '23505' ? 'That order number is already in use. Choose a different one.' : error.message)
  const order = orderRow(data as Record<string, unknown>)
  if (items.length) {
    await sb.from('order_line_items').insert(items.map((i, idx) => lineInsert(c.tenantId, order.id, i, totals[idx], idx)))
  }
  await addEvent(order.id, 'created', { orderNumber })
  return order
}

export async function updateOrder(id: string, patch: OrderInput): Promise<Order | null> {
  const c = await ctx(); if (!c) return null
  const sb = await createClient()
  const m: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const map: Record<string, string> = { orderNumber: 'order_number', contactId: 'contact_id', customerName: 'customer_name', customerEmail: 'customer_email', customerPhone: 'customer_phone', factoryName: 'factory_name', factoryContactName: 'factory_contact_name', factoryEmail: 'factory_email', assignedEmployee: 'assigned_employee', orderDate: 'order_date', requestedCompletionDate: 'requested_completion_date', estimatedCompletionDate: 'estimated_completion_date', depositCents: 'deposit_cents', currency: 'currency', clientRequirements: 'client_requirements', isCustomDesign: 'is_custom_design', internalNotes: 'internal_notes', publicNotes: 'public_notes', deliveryProvince: 'delivery_province', documentTemplateId: 'document_template_id' }
  // Only keys actually PRESENT in the patch are written. That is what lets add_orders_6's columns be
  // optional: a form that does not send delivery_province never names it, so a database without the
  // column is never asked about it.
  for (const [k, col] of Object.entries(map)) if (k in patch) m[col] = (patch as Record<string, unknown>)[k]
  // Never blank out the (NOT NULL, unique) order number — ignore an empty edit.
  if (typeof m.order_number === 'string') { const t = m.order_number.trim(); if (t) m.order_number = t; else delete m.order_number }
  // Re-price if line items are replaced.
  if (patch.lineItems) {
    const totals = lineTotals(patch.lineItems); const subtotal = totals.reduce((s, n) => s + n, 0)
    m.subtotal_cents = subtotal; m.balance_cents = subtotal - (patch.depositCents ?? 0)
    await sb.from('order_line_items').delete().eq('order_id', id)
    if (patch.lineItems.length) await sb.from('order_line_items').insert(patch.lineItems.map((i, idx) => lineInsert(c.tenantId, id, i, totals[idx], idx)))
  }
  const { data, error } = await sb.from('orders').update(m).eq('tenant_id', c.tenantId).eq('id', id).select('*').single()
  if (error) throw new Error(error.code === '23505' ? 'That order number is already in use. Choose a different one.' : error.message)
  await addEvent(id, 'updated', null)
  return orderRow(data as Record<string, unknown>)
}

// Manual stage change (drag / explicit set) — approval stages are rejected here; use the workflow actions.
export async function setStageManual(id: string, to: OrderStage): Promise<{ ok: boolean; error?: string }> {
  const c = await ctx(); if (!c) return { ok: false, error: 'unauthorized' }
  const sb = await createClient()
  const { data } = await sb.from('orders').select('stage').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: 'not found' }
  const from = data.stage as OrderStage
  if (!canManualTransition(from, to)) return { ok: false, error: `Transition ${from} → ${to} is not allowed (approval stages change via workflow actions only)` }
  await sb.from('orders').update({ stage: to, updated_at: new Date().toISOString() }).eq('tenant_id', c.tenantId).eq('id', id)
  await addEvent(id, 'stage_changed', { from, to, manual: true })
  return { ok: true }
}

// Permanently delete an order. Removes its private storage files first (not FK-cascaded), then deletes the
// order row — line items, events, attachments rows, and approval requests are removed by ON DELETE CASCADE.
export async function deleteOrder(id: string): Promise<boolean> {
  const c = await ctx(); if (!c) return false
  const sb = await createClient()
  const { data: order } = await sb.from('orders').select('id').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  if (!order) return false
  const { data: atts } = await sb.from('order_attachments').select('storage_path').eq('tenant_id', c.tenantId).eq('order_id', id)
  const paths = ((atts as Array<Record<string, unknown>> | null) ?? []).map((a) => a.storage_path as string).filter(Boolean)
  if (paths.length) await createAdminClient().storage.from(ORDER_BUCKET).remove(paths)
  const { error } = await sb.from('orders').delete().eq('tenant_id', c.tenantId).eq('id', id)
  return !error
}

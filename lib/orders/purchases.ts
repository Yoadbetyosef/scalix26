import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { addEvent } from './store'
import type { OrderPurchase, PurchaseInput, PurchaseKind, PurchaseStatus } from './purchase-types'

export * from './purchase-types'

// ── WHAT WAS BOUGHT TO MAKE THIS PIECE ──────────────────────────────────────────────────────────
//
// The stone from the dealer, the mounting from the caster, the setting from the goldsmith. Each is
// a row on the order it is for, with who it came from, what it cost, when it was ordered, when it
// is expected, when it arrived and whether it passed QC. The supplier's invoice, when there is one,
// is an ordinary order attachment (internal) linked by id — the same upload path as everything
// else, so there is no second place files live.
//
// Deliberately NOT the landed-cost supplier-invoice module (lib/invoices): that reads a whole
// shipment's invoice and spreads freight across catalogue products. This is one line for one job.

export const PURCHASES_MIGRATION = 'add_tg_production_1.sql'
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
const row = (r: Record<string, unknown>): OrderPurchase => ({
  id: r.id as string, orderId: (r.order_id as string) ?? null, supplierId: (r.supplier_id as string) ?? null, supplierName: (r.supplier_name as string) ?? null,
  kind: (r.kind as PurchaseKind) ?? 'other', description: r.description as string, quantity: Number(r.quantity ?? 1), costCents: num(r.cost_cents), currency: (r.currency as string) ?? 'usd',
  reference: (r.reference as string) ?? null, status: (r.status as PurchaseStatus) ?? 'draft',
  orderedOn: (r.ordered_on as string) ?? null, expectedOn: (r.expected_on as string) ?? null, receivedOn: (r.received_on as string) ?? null, qcNote: (r.qc_note as string) ?? null,
  invoiceAttachmentId: (r.invoice_attachment_id as string) ?? null, notes: (r.notes as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
})

export async function listPurchases(orderId: string): Promise<{ purchases: OrderPurchase[]; missing: boolean }> {
  const c = await requireActiveBusinessContext(); if (!c) return { purchases: [], missing: false }
  const { data, error } = await createAdminClient().from('order_purchases').select('*').eq('tenant_id', c.tenantId).eq('order_id', orderId).order('created_at')
  if (error) return { purchases: [], missing: error.code === '42P01' || error.code === 'PGRST205' }
  return { purchases: ((data as Array<Record<string, unknown>> | null) ?? []).map(row), missing: false }
}

const toRow = (i: Partial<PurchaseInput>) => {
  const m: Record<string, unknown> = {}
  const map: Record<string, string> = { supplierId: 'supplier_id', supplierName: 'supplier_name', kind: 'kind', description: 'description', quantity: 'quantity', costCents: 'cost_cents', currency: 'currency', reference: 'reference', status: 'status', orderedOn: 'ordered_on', expectedOn: 'expected_on', receivedOn: 'received_on', qcNote: 'qc_note', invoiceAttachmentId: 'invoice_attachment_id', notes: 'notes' }
  for (const [k, col] of Object.entries(map)) if (k in i) m[col] = (i as Record<string, unknown>)[k]
  return m
}

export async function createPurchase(orderId: string, input: PurchaseInput): Promise<{ ok: boolean; error?: string; purchase?: OrderPurchase }> {
  const c = await requireActiveBusinessContext(); if (!c) return { ok: false, error: 'Not signed in' }
  const db = createAdminClient()
  const { data: order } = await db.from('orders').select('id, currency').eq('tenant_id', c.tenantId).eq('id', orderId).maybeSingle()
  if (!order) return { ok: false, error: 'Order not found' }
  const { data, error } = await db.from('order_purchases').insert({
    tenant_id: c.tenantId, order_id: orderId, created_by: c.actorUserId,
    ...toRow({ kind: 'other', quantity: 1, status: 'draft', currency: (order.currency as string) ?? 'usd', ...input }),
  }).select('*').single()
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return { ok: false, error: `Run ${PURCHASES_MIGRATION} (part 5) in the Supabase SQL editor first — purchases are not set up yet.` }
    return { ok: false, error: error.message }
  }
  const p = row(data as Record<string, unknown>)
  await addEvent(orderId, 'purchase_added', { purchaseId: p.id, kind: p.kind, description: p.description, supplier: p.supplierName })
  return { ok: true, purchase: p }
}

export async function updatePurchase(orderId: string, id: string, patch: Partial<PurchaseInput>): Promise<{ ok: boolean; error?: string; purchase?: OrderPurchase }> {
  const c = await requireActiveBusinessContext(); if (!c) return { ok: false, error: 'Not signed in' }
  const db = createAdminClient()
  const { data: before } = await db.from('order_purchases').select('status').eq('tenant_id', c.tenantId).eq('order_id', orderId).eq('id', id).maybeSingle()
  if (!before) return { ok: false, error: 'Purchase not found' }
  const m = toRow(patch)
  // Received implies a received date; QC passed implies received.
  if ((patch.status === 'received' || patch.status === 'qc_done') && !('receivedOn' in patch)) m.received_on = new Date().toISOString().slice(0, 10)
  const { data, error } = await db.from('order_purchases').update({ ...m, updated_at: new Date().toISOString() }).eq('tenant_id', c.tenantId).eq('order_id', orderId).eq('id', id).select('*').single()
  if (error) return { ok: false, error: error.message }
  const p = row(data as Record<string, unknown>)
  if (patch.status && patch.status !== before.status) await addEvent(orderId, 'purchase_status', { purchaseId: id, from: before.status, to: patch.status, description: p.description })
  return { ok: true, purchase: p }
}

export async function deletePurchase(orderId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const c = await requireActiveBusinessContext(); if (!c) return { ok: false, error: 'Not signed in' }
  const { error, data } = await createAdminClient().from('order_purchases').delete().eq('tenant_id', c.tenantId).eq('order_id', orderId).eq('id', id).select('id, description')
  if (error) return { ok: false, error: error.message }
  if (!data?.length) return { ok: false, error: 'Purchase not found' }
  await addEvent(orderId, 'purchase_removed', { purchaseId: id, description: data[0].description })
  return { ok: true }
}

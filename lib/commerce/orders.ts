import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireCommerceAccess } from './guard'
import { addCommerceEvent } from './events'
import { generateOrderNumber } from './number'

// Pure: an order line's missing quantity (what still needs purchasing) and its coverage buckets (§7).
export function lineCoverage(i: { quantity_ordered: number; quantity_allocated: number; quantity_received: number; quantity_delivered: number }) {
  const ordered = Number(i.quantity_ordered), allocated = Number(i.quantity_allocated), received = Number(i.quantity_received), delivered = Number(i.quantity_delivered)
  return { ordered, allocated, missing: Math.max(0, ordered - allocated), received, delivered }
}

// Convert a Draft to a Customer Order via the transaction-safe, IDEMPOTENT RPC. Repeated calls return the
// same order (never a duplicate). Generates the order number here; the RPC does everything else atomically.
export async function convertDraft(draftId: string): Promise<{ ok: boolean; orderId?: string; idempotent?: boolean; ordered?: number; allocated?: number; missing?: number; error?: string }> {
  const c = await requireCommerceAccess(); if (!c) return { ok: false, error: 'unauthorized' }
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('convert_draft_to_order', { p_tenant: c.tenantId, p_draft_id: draftId, p_order_number: generateOrderNumber(), p_created_by: c.actor })
  if (error) return { ok: false, error: error.message }
  const r = (data ?? {}) as Record<string, unknown>
  if (!r.ok) return { ok: false, error: (r.error as string) ?? 'conversion_failed' }
  if (!r.idempotent) await addCommerceEvent(c.tenantId, 'draft', draftId, 'converted', { orderId: r.order_id }, c.actor)
  return { ok: true, orderId: r.order_id as string, idempotent: !!r.idempotent, ordered: r.ordered as number, allocated: r.allocated as number, missing: r.missing as number }
}

export async function listOrders() {
  const c = await requireCommerceAccess(); if (!c) return []
  const sb = await createClient()
  const { data } = await sb.from('commerce_customer_orders').select('id, order_number, customer_name, status, payment_status, total_cents, currency, created_at').eq('tenant_id', c.tenantId).order('created_at', { ascending: false }).limit(200)
  return data ?? []
}

export async function getOrder(id: string) {
  const c = await requireCommerceAccess(); if (!c) return null
  const sb = await createClient()
  const [{ data: order }, { data: items }] = await Promise.all([
    sb.from('commerce_customer_orders').select('*').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle(),
    sb.from('commerce_order_items').select('*').eq('tenant_id', c.tenantId).eq('order_id', id).order('display_order'),
  ])
  if (!order) return null
  return { order, items: items ?? [] }
}

// Items that still need purchasing (allocated < ordered) — feeds Phase 4 Purchase Orders.
export async function missingItemsForOrder(orderId: string) {
  const d = await getOrder(orderId)
  if (!d) return []
  return (d.items as Record<string, unknown>[]).map((i) => ({ ...lineCoverage(i as never), item: i })).filter((x) => x.missing > 0)
}

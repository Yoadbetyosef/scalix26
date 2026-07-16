import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireCommerceAccess } from './guard'
import { addCommerceEvent } from './events'
import { generatePONumber } from './number'
import { determineApprovalLevel, canSendPO } from './approval'
import { sendEmail } from '@/lib/email/send'
import { missingItemsForOrder } from './orders'

const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`

export interface POItemInput { productId?: string | null; variantId?: string | null; description?: string | null; sku?: string | null; quantity: number; unitCostCents: number; isCustom?: boolean; customerOrderItemId?: string | null }

export async function createPO(input: { supplierId?: string | null; customerOrderId?: string | null; items: POItemInput[] }) {
  const c = await requireCommerceAccess(); if (!c) return { ok: false as const, error: 'unauthorized' }
  if (!input.items.length) return { ok: false as const, error: 'no_items' }
  const sb = await createClient()
  const subtotal = input.items.reduce((s, i) => s + Math.round(i.quantity * i.unitCostCents), 0)
  const hasCustom = input.items.some((i) => i.isCustom)
  const approval = determineApprovalLevel(subtotal, hasCustom)
  const status = approval === 'none' ? 'draft' : 'awaiting_approval'
  const { data: po, error } = await sb.from('commerce_purchase_orders').insert({
    tenant_id: c.tenantId, po_number: generatePONumber(), supplier_id: input.supplierId ?? null, customer_order_id: input.customerOrderId ?? null,
    status, subtotal_cents: subtotal, total_cost_cents: subtotal, approval_required: approval, requested_by: c.actor, created_by: c.actor,
  }).select('id, po_number').single()
  if (error) return { ok: false as const, error: error.message }
  const { error: iErr } = await sb.from('commerce_po_items').insert(input.items.map((i, idx) => ({
    tenant_id: c.tenantId, po_id: po.id, product_id: i.productId ?? null, variant_id: i.variantId ?? null,
    description_snapshot: i.description ?? null, sku_snapshot: i.sku ?? null, quantity: i.quantity, unit_cost_cents: i.unitCostCents,
    is_custom: !!i.isCustom, customer_order_id: input.customerOrderId ?? null, customer_order_item_id: i.customerOrderItemId ?? null, display_order: idx,
  })))
  if (iErr) return { ok: false as const, error: iErr.message }
  await addCommerceEvent(c.tenantId, 'purchase_order', po.id as string, 'created', { approval, subtotalCents: subtotal }, c.actor)
  return { ok: true as const, po: { id: po.id as string, poNumber: po.po_number as string, approval, status } }
}

// Build a PO from a customer order's MISSING items (allocated < ordered) — §9. Never combines suppliers
// automatically; the caller passes the chosen supplier after seeing the missing lines.
export async function proposePOFromOrderMissing(orderId: string, supplierId: string | null) {
  const c = await requireCommerceAccess(); if (!c) return { ok: false as const, error: 'unauthorized' }
  const missing = await missingItemsForOrder(orderId)
  if (!missing.length) return { ok: false as const, error: 'nothing_missing' }
  return createPO({ supplierId, customerOrderId: orderId, items: missing.map((m) => ({
    productId: (m.item.product_id as string) ?? null, variantId: (m.item.variant_id as string) ?? null,
    description: (m.item.description_snapshot as string) ?? null, sku: (m.item.sku_snapshot as string) ?? null,
    quantity: m.missing, unitCostCents: Number(m.item.cost_cents_snapshot ?? 0), customerOrderItemId: m.item.id as string,
  })) })
}

export async function approvePO(poId: string) {
  const c = await requireCommerceAccess(); if (!c) return { ok: false, error: 'unauthorized' }
  const sb = await createClient()
  const { data } = await sb.from('commerce_purchase_orders').update({ status: 'approved', approved_by: c.actor, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('tenant_id', c.tenantId).eq('id', poId).eq('status', 'awaiting_approval').select('id')
  if (!data || data.length === 0) return { ok: false, error: 'not_awaiting_approval' }
  await addCommerceEvent(c.tenantId, 'purchase_order', poId, 'approved', null, c.actor)
  return { ok: true }
}

export async function rejectPO(poId: string, reason: string) {
  const c = await requireCommerceAccess(); if (!c) return { ok: false, error: 'unauthorized' }
  const sb = await createClient()
  await sb.from('commerce_purchase_orders').update({ status: 'cancelled', rejected_by: c.actor, rejection_reason: reason, updated_at: new Date().toISOString() }).eq('tenant_id', c.tenantId).eq('id', poId)
  await addCommerceEvent(c.tenantId, 'purchase_order', poId, 'rejected', { reason }, c.actor)
  return { ok: true }
}

function poEmailHtml(poNumber: string, supplierName: string, items: Array<Record<string, unknown>>): string {
  const rows = items.map((i) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${(i.description_snapshot as string) || 'Item'}${i.sku_snapshot ? ` <span style="color:#888">(${i.sku_snapshot})</span>` : ''}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${i.quantity}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${money(Number(i.unit_cost_cents))}</td></tr>`).join('')
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <h1 style="font-size:20px">Purchase Order ${poNumber}</h1>
    <p style="font-size:14px;color:#4b5563">To: ${supplierName}. Please review the order below and confirm availability and ship date.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #111">Item</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #111">Qty</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #111">Unit cost</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="font-size:13px;color:#6b7280;margin-top:16px">Please reply to confirm this order, availability, and the expected ship date.</p>
  </div></body></html>`
}

// Send the approved PO to the factory via the centralized email service. The PO is NOT marked sent until
// the email provider accepts it; on failure the PO stays approved with a bumped retry count (§11).
export async function sendToFactory(poId: string, locationId: string) {
  const c = await requireCommerceAccess(); if (!c) return { ok: false, error: 'unauthorized' }
  const sb = await createClient()
  const { data: po } = await sb.from('commerce_purchase_orders').select('*').eq('tenant_id', c.tenantId).eq('id', poId).maybeSingle()
  if (!po) return { ok: false, error: 'not_found' }
  if (!canSendPO(po.status as string, po.approval_required as 'none' | 'manager' | 'admin')) return { ok: false, error: 'approval_required' }
  const { data: sup } = po.supplier_id ? await sb.from('commerce_suppliers').select('company_name, email').eq('id', po.supplier_id as string).maybeSingle() : { data: null }
  const to = sup?.email as string | undefined
  if (!to) return { ok: false, error: 'no_supplier_email' }
  const { data: items } = await sb.from('commerce_po_items').select('description_snapshot, sku_snapshot, quantity, unit_cost_cents').eq('tenant_id', c.tenantId).eq('po_id', poId)
  const subject = `Purchase Order ${po.po_number}`
  const html = poEmailHtml(po.po_number as string, (sup?.company_name as string) || 'Supplier', items ?? [])
  const result = await sendEmail(to, subject, html, { tenantId: c.tenantId })
  if (!result.success) {
    await sb.from('commerce_purchase_orders').update({ email_status: 'failed', email_retry_count: Number(po.email_retry_count ?? 0) + 1, email_recipient: to, updated_at: new Date().toISOString() }).eq('tenant_id', c.tenantId).eq('id', poId)
    return { ok: false, error: `email_failed`, detail: result.error, retry: true }
  }
  // Success → the PO's quantities become expected incoming stock, and the PO is marked sent.
  await createAdminClient().rpc('mark_po_incoming', { p_tenant: c.tenantId, p_po_id: poId, p_location_id: locationId, p_by: c.actor })
  await sb.from('commerce_purchase_orders').update({
    status: 'sent_to_supplier', email_status: 'sent', email_message_id: result.id, email_recipient: to, email_subject: subject,
    email_sent_at: new Date().toISOString(), email_sent_by: c.actor, email_content_snapshot: html, updated_at: new Date().toISOString(),
  }).eq('tenant_id', c.tenantId).eq('id', poId)
  await addCommerceEvent(c.tenantId, 'purchase_order', poId, 'sent_to_factory', { to, messageId: result.id }, c.actor)
  return { ok: true, messageId: result.id }
}

// Receive goods against a PO via the transaction-safe, idempotent RPC.
export async function receivePO(poId: string, locationId: string, lines: Array<{ poItemId: string; accepted: number; damaged?: number }>, idempotencyKey: string) {
  const c = await requireCommerceAccess(); if (!c) return { ok: false, error: 'unauthorized' }
  const { data, error } = await createAdminClient().rpc('receive_po_items', {
    p_tenant: c.tenantId, p_po_id: poId, p_location_id: locationId,
    p_lines: lines.map((l) => ({ po_item_id: l.poItemId, accepted: l.accepted, damaged: l.damaged ?? 0 })),
    p_received_by: c.actor, p_idempotency_key: idempotencyKey,
  })
  if (error) return { ok: false, error: error.message }
  const r = (data ?? {}) as Record<string, unknown>
  if (!r.ok) return { ok: false, error: (r.error as string) ?? 'receive_failed' }
  return { ok: true, receiptId: r.receipt_id as string, idempotent: !!r.idempotent }
}

export async function listPOs() {
  const c = await requireCommerceAccess(); if (!c) return []
  const sb = await createClient()
  const { data } = await sb.from('commerce_purchase_orders').select('id, po_number, status, approval_required, email_status, total_cost_cents, currency, created_at').eq('tenant_id', c.tenantId).order('created_at', { ascending: false }).limit(200)
  return data ?? []
}

export async function getPO(id: string) {
  const c = await requireCommerceAccess(); if (!c) return null
  const sb = await createClient()
  const [{ data: po }, { data: items }] = await Promise.all([
    sb.from('commerce_purchase_orders').select('*').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle(),
    sb.from('commerce_po_items').select('*').eq('tenant_id', c.tenantId).eq('po_id', id).order('display_order'),
  ])
  if (!po) return null
  return { po, items: items ?? [] }
}

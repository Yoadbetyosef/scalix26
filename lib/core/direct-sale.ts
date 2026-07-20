import { createAdminClient } from '@/lib/supabase/server'
import { createDocument, addLine } from './documents'
import { generateOrderNumber } from '@/lib/orders/order-number'

// Direct sale: Catalog → (customer + lines) → Invoice or Order, with NO proposal required. Reuses the Core
// invoice repo (createDocument/addLine) and the legacy orders system, so there is no third sales path.
const admin = () => createAdminClient()

export interface DirectLine { productId?: string | null; componentId?: string | null; variantId?: string | null; description?: string | null; quantity: number; unit_price_cents: number; customAttributes?: Record<string, unknown> }

export async function createDirectSale(tenantId: string, actor: string, input: { target: 'invoice' | 'order'; contactId?: string | null; lines: DirectLine[] }): Promise<{ ok: true; target: 'invoice' | 'order'; id: string; number: string } | { ok: false; error: string }> {
  if (!input.lines.length) return { ok: false, error: 'no_lines' }

  if (input.target === 'invoice') {
    const created = await createDocument(tenantId, 'invoice', { contactId: input.contactId ?? null }, actor)
    if (!created.ok) return created
    const invId = (created.document.id as string)
    for (const l of input.lines) {
      const r = await addLine(tenantId, 'invoice', invId, { productId: l.productId ?? null, variantId: l.variantId ?? null, componentId: l.componentId ?? null, description: l.description ?? null, quantity: l.quantity, unit_price_cents: l.unit_price_cents, customAttributes: l.customAttributes })
      if (!r.ok) return r
    }
    return { ok: true, target: 'invoice', id: invId, number: created.document.number as string }
  }

  // Legacy order
  const contact = input.contactId ? (await admin().from('contacts').select('name, phone, email').eq('tenant_id', tenantId).eq('id', input.contactId).maybeSingle()).data : null
  const orderNumber = generateOrderNumber()
  const subtotal = input.lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_price_cents), 0)
  const { data: order, error } = await admin().from('orders').insert({
    tenant_id: tenantId, order_number: orderNumber, contact_id: input.contactId ?? null,
    customer_name: (contact?.name as string) ?? null, customer_email: (contact?.email as string) ?? null, customer_phone: (contact?.phone as string) ?? null,
    subtotal_cents: subtotal, currency: 'usd', created_by: actor,
  }).select('id').single()
  if (error || !order) return { ok: false, error: error?.message || 'order_create_failed' }
  await admin().from('order_line_items').insert(input.lines.map((l, i) => { const a = l.customAttributes ?? {}
    return { tenant_id: tenantId, order_id: order.id, product_name: l.description || 'Item', description: l.description ?? null, sku: (a.sku as string) ?? null, quantity: l.quantity, unit_price_cents: l.unit_price_cents, line_total_cents: Math.round(l.quantity * l.unit_price_cents), product_ref: l.productId ?? null, measurements: (a.dimensions as string) ?? null, color: (a.color as string) ?? null, material: (a.fabric as string) ?? (a.material as string) ?? null, display_order: i }
  }))
  await admin().from('order_events').insert({ tenant_id: tenantId, order_id: order.id, type: 'created', actor: 'system', payload: { direct_sale: true } })
  return { ok: true, target: 'order', id: order.id as string, number: orderNumber }
}

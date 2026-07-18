import { createAdminClient } from '@/lib/supabase/server'

// Product components — physical pieces/parts of a product or variant (generic BOM; e.g. sofa sections,
// table base/top, kit parts). NOT variants. Each carries a qr_code_token for a public per-piece page.
// This generalizes the furniture "parts + QR" behavior into a Core, industry-neutral structure.
const admin = () => createAdminClient()

export interface ComponentInput { name: string; sku?: string | null; imageUrl?: string | null; quantity?: number; priceCents?: number | null; currency?: string; status?: string; variantId?: string | null; notes?: string | null }

export async function listComponents(tenantId: string, productId: string) {
  const { data } = await admin().from('product_components').select('*').eq('tenant_id', tenantId).eq('product_id', productId).order('sort_order')
  return data ?? []
}
export async function createComponent(tenantId: string, productId: string, input: ComponentInput): Promise<{ ok: true; component: Record<string, unknown> } | { ok: false; error: string }> {
  if (!input.name?.trim()) return { ok: false, error: 'name_required' }
  if (input.priceCents != null && !Number.isInteger(input.priceCents)) return { ok: false, error: 'price_must_be_integer_minor_units' }
  const { count } = await admin().from('product_components').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('product_id', productId)
  const { data, error } = await admin().from('product_components').insert({
    tenant_id: tenantId, product_id: productId, variant_id: input.variantId ?? null, name: input.name.trim(), sku: input.sku ?? null,
    image_url: input.imageUrl ?? null, quantity: input.quantity ?? 1, price_cents: input.priceCents ?? null, currency: input.currency ?? 'usd',
    status: input.status ?? 'active', notes: input.notes ?? null, sort_order: count ?? 0,
  }).select('*').single()
  return error ? { ok: false, error: error.message } : { ok: true, component: data as Record<string, unknown> }
}
export async function updateComponent(tenantId: string, id: string, patch: Partial<ComponentInput>) {
  if (patch.priceCents != null && !Number.isInteger(patch.priceCents)) return { ok: false as const, error: 'price_must_be_integer_minor_units' }
  const db: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name != null) db.name = patch.name.trim()
  if (patch.sku !== undefined) db.sku = patch.sku
  if (patch.imageUrl !== undefined) db.image_url = patch.imageUrl
  if (patch.quantity != null) db.quantity = patch.quantity
  if (patch.priceCents !== undefined) db.price_cents = patch.priceCents
  if (patch.status != null) db.status = patch.status
  if (patch.notes !== undefined) db.notes = patch.notes
  const { data } = await admin().from('product_components').update(db).eq('tenant_id', tenantId).eq('id', id).select('*').maybeSingle()
  return data ? { ok: true as const, component: data } : { ok: false as const, error: 'not_found' }
}
export async function deleteComponent(tenantId: string, id: string) {
  const { error } = await admin().from('product_components').delete().eq('tenant_id', tenantId).eq('id', id)
  return !error
}

// Public lookup by unguessable token (no auth) — customer-safe fields only.
export async function getComponentByToken(token: string) {
  const { data } = await admin().from('product_components').select('name, image_url, price_cents, currency, status, product_id, variant_id').eq('qr_code_token', token).maybeSingle()
  return data ?? null
}

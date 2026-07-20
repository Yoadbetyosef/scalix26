import { createAdminClient } from '@/lib/supabase/server'

// Product variants — sellable versions of a product (size/material/finish/config). Money in integer minor
// units (cents) + explicit currency. Tenant-scoped.
const admin = () => createAdminClient()

export interface VariantInput { name: string; sku?: string | null; priceOverrideCents?: number | null; costCents?: number | null; currency?: string; status?: string; trackInventory?: boolean; imageUrl?: string | null }

export async function listVariants(tenantId: string, productId: string) {
  const { data } = await admin().from('product_variants').select('*').eq('tenant_id', tenantId).eq('product_id', productId).order('sort_order')
  return data ?? []
}
export async function getVariant(tenantId: string, id: string) {
  const { data } = await admin().from('product_variants').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  return data ?? null
}
// Variants of a COMPONENT (component-owned). Same table, component_id set instead of product_id.
export async function listComponentVariants(tenantId: string, componentId: string) {
  const { data } = await admin().from('product_variants').select('*').eq('tenant_id', tenantId).eq('component_id', componentId).order('sort_order')
  return data ?? []
}
async function insertVariant(tenantId: string, owner: { product_id?: string | null; component_id?: string | null }, input: VariantInput) {
  if (!input.name?.trim()) return { ok: false as const, error: 'name_required' }
  if (input.priceOverrideCents != null && !Number.isInteger(input.priceOverrideCents)) return { ok: false as const, error: 'price_must_be_integer_minor_units' }
  if (input.costCents != null && !Number.isInteger(input.costCents)) return { ok: false as const, error: 'cost_must_be_integer_minor_units' }
  let q = admin().from('product_variants').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
  q = owner.component_id ? q.eq('component_id', owner.component_id) : q.eq('product_id', owner.product_id!)
  const { count } = await q
  const { data, error } = await admin().from('product_variants').insert({
    tenant_id: tenantId, product_id: owner.product_id ?? null, component_id: owner.component_id ?? null, name: input.name.trim(), sku: input.sku ?? null,
    price_override_cents: input.priceOverrideCents ?? null, cost_cents: input.costCents ?? null, currency: input.currency ?? 'usd',
    status: input.status ?? 'active', track_inventory: input.trackInventory ?? true, image_url: input.imageUrl ?? null, sort_order: count ?? 0,
  }).select('*').single()
  return error ? { ok: false as const, error: error.message } : { ok: true as const, variant: data }
}
export async function createVariant(tenantId: string, productId: string, input: VariantInput) {
  return insertVariant(tenantId, { product_id: productId }, input)
}
export async function createComponentVariant(tenantId: string, componentId: string, input: VariantInput) {
  return insertVariant(tenantId, { component_id: componentId }, input)
}
export async function updateVariant(tenantId: string, id: string, patch: Partial<VariantInput>) {
  if (patch.priceOverrideCents != null && !Number.isInteger(patch.priceOverrideCents)) return { ok: false as const, error: 'price_must_be_integer_minor_units' }
  if (patch.costCents != null && !Number.isInteger(patch.costCents)) return { ok: false as const, error: 'cost_must_be_integer_minor_units' }
  const db: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name != null) db.name = patch.name.trim()
  if (patch.sku !== undefined) db.sku = patch.sku
  if (patch.priceOverrideCents !== undefined) db.price_override_cents = patch.priceOverrideCents
  if (patch.costCents !== undefined) db.cost_cents = patch.costCents
  if (patch.status != null) db.status = patch.status
  if (patch.trackInventory != null) db.track_inventory = patch.trackInventory
  if (patch.imageUrl !== undefined) db.image_url = patch.imageUrl
  const { data } = await admin().from('product_variants').update(db).eq('tenant_id', tenantId).eq('id', id).select('*').maybeSingle()
  return data ? { ok: true as const, variant: data } : { ok: false as const, error: 'not_found' }
}
export async function deleteVariant(tenantId: string, id: string) {
  const { error } = await admin().from('product_variants').delete().eq('tenant_id', tenantId).eq('id', id)
  return !error
}

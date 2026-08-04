import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { requireCatalogTenant } from './session'

// What a product costs the business, and the margin that follows from it.
//
// Two things make this different from ordinary catalog data:
//
//   1. Reads go through the RLS-scoped client, NOT the admin client the rest of the catalog uses. Most
//      of this app reads tenant data with the service role, which bypasses RLS entirely — and a policy
//      that nothing ever exercises is decoration. Using the authenticated client here is what makes the
//      database a real second layer rather than a claim in a comment.
//
//   2. computed_cost is a GENERATED column. Nothing in this file calculates it, and nothing may write
//      it: the value cannot disagree with the components it came from, no matter which client wrote
//      them. Margin, which needs the selling price from another table, is derived on read.

export interface CostSettings { markupPercent: number; baseCurrency: string; secondaryCurrency: string | null }

export interface ProductCost {
  productId: string
  costPrimary: number | null
  costSecondary: number | null
  shippingCost: number
  tariffCost: number
  markupPercent: number
  computedCost: number | null   // null when nothing has been recorded — never 0
  updatedAt: string | null
}

export interface ProductCostView {
  settings: CostSettings
  price: number | null          // the selling price, for the margin figure
  cost: ProductCost | null      // null when no cost has been recorded yet
  marginPercent: number | null  // null when either side is unknown
}

export interface CostInput {
  costPrimary?: number | null
  costSecondary?: number | null
  shippingCost?: number
  tariffCost?: number
}

// 'forbidden' is returned rather than an empty result so the caller can answer 403 — a blank response
// would be indistinguishable from "this product has no cost recorded", which is a different fact.
export type CostResult<T> = { ok: true; data: T } | { ok: false; reason: 'not_found' | 'forbidden' }

const row = (r: Record<string, unknown>): ProductCost => ({
  productId: r.product_id as string,
  costPrimary: r.cost_primary === null || r.cost_primary === undefined ? null : Number(r.cost_primary),
  costSecondary: r.cost_secondary === null || r.cost_secondary === undefined ? null : Number(r.cost_secondary),
  shippingCost: Number(r.shipping_cost ?? 0),
  tariffCost: Number(r.tariff_cost ?? 0),
  markupPercent: Number(r.markup_percent ?? 0),
  computedCost: r.computed_cost === null || r.computed_cost === undefined ? null : Number(r.computed_cost),
  updatedAt: (r.updated_at as string) ?? null,
})

// Margin against the selling price: what proportion of the price is not cost. Undefined without both
// numbers, and undefined at a zero price rather than dividing by it.
const margin = (price: number | null, cost: number | null): number | null =>
  price === null || cost === null || price <= 0 ? null : ((price - cost) / price) * 100

// The tenant's own defaults. Nothing here is assumed: a tenant with no secondary currency gets null and
// never sees that field.
export async function getCostSettings(tenantId: string): Promise<CostSettings> {
  const { data } = await createAdminClient()
    .from('tenants').select('cost_markup_percent, cost_base_currency, cost_secondary_currency')
    .eq('id', tenantId).maybeSingle()
  return {
    markupPercent: Number(data?.cost_markup_percent ?? 10),
    baseCurrency: (data?.cost_base_currency as string) || 'USD',
    secondaryCurrency: (data?.cost_secondary_currency as string) || null,
  }
}

// The single gate: the catalog module must be on AND this session must be allowed to see costs. An
// operator (White Label partner) is refused here before a single row is read.
async function costAccess(): Promise<{ tenantId: string; actorUserId: string } | 'not_found' | 'forbidden'> {
  const s = await requireCatalogTenant()
  if (!s) return 'not_found'
  const c = await requireActiveBusinessContext()
  if (!c) return 'not_found'
  if (!c.capabilities.canViewCosts) return 'forbidden'
  return { tenantId: s.tenantId, actorUserId: c.actorUserId }
}

export async function getProductCost(productId: string): Promise<CostResult<ProductCostView>> {
  const a = await costAccess()
  if (a === 'not_found' || a === 'forbidden') return { ok: false, reason: a }

  // Admin client for the product itself (ordinary catalog data, read the same way as everywhere else)…
  const { data: product } = await createAdminClient()
    .from('catalog_products').select('id, price').eq('tenant_id', a.tenantId).eq('id', productId).maybeSingle()
  if (!product) return { ok: false, reason: 'not_found' }

  // …and the RLS-scoped client for the cost, so the policy actually runs.
  const sb = await createClient()
  const { data } = await sb.from('product_costs').select('*').eq('product_id', productId).maybeSingle()

  const price = product.price === null || product.price === undefined ? null : Number(product.price)
  const cost = data ? row(data as Record<string, unknown>) : null
  return {
    ok: true,
    data: {
      settings: await getCostSettings(a.tenantId),
      price,
      cost,
      marginPercent: margin(price, cost?.computedCost ?? null),
    },
  }
}

// Upsert. markup_percent is snapshotted from the tenant default at save time, so changing that default
// later never silently rewrites what a product cost last quarter. computed_cost is omitted entirely —
// the database generates it.
export async function saveProductCost(productId: string, input: CostInput): Promise<CostResult<ProductCostView>> {
  const a = await costAccess()
  if (a === 'not_found' || a === 'forbidden') return { ok: false, reason: a }

  const { data: product } = await createAdminClient()
    .from('catalog_products').select('id').eq('tenant_id', a.tenantId).eq('id', productId).maybeSingle()
  if (!product) return { ok: false, reason: 'not_found' }

  const sb = await createClient()
  const { data: existing } = await sb.from('product_costs').select('markup_percent').eq('product_id', productId).maybeSingle()
  // Keep the markup already snapshotted on an existing row; only a brand-new row takes today's default.
  const markup = existing ? Number(existing.markup_percent) : (await getCostSettings(a.tenantId)).markupPercent

  const { error } = await sb.from('product_costs').upsert({
    tenant_id: a.tenantId,
    product_id: productId,
    cost_primary: input.costPrimary ?? null,
    cost_secondary: input.costSecondary ?? null,
    shipping_cost: input.shippingCost ?? 0,
    tariff_cost: input.tariffCost ?? 0,
    markup_percent: markup,
    updated_at: new Date().toISOString(),
    updated_by: a.actorUserId,
  }, { onConflict: 'product_id' })
  if (error) throw new Error(error.message)

  return getProductCost(productId)
}

// Re-snapshot a single product onto the tenant's CURRENT default markup — an explicit act, never a
// side effect of changing the default.
export async function applyCurrentMarkup(productId: string): Promise<CostResult<ProductCostView>> {
  const a = await costAccess()
  if (a === 'not_found' || a === 'forbidden') return { ok: false, reason: a }
  const sb = await createClient()
  const { error } = await sb.from('product_costs')
    .update({ markup_percent: (await getCostSettings(a.tenantId)).markupPercent, updated_at: new Date().toISOString(), updated_by: a.actorUserId })
    .eq('product_id', productId)
  if (error) throw new Error(error.message)
  return getProductCost(productId)
}

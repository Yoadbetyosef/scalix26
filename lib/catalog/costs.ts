import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { requireCatalogTenant } from './session'
import { enabledModulesOf } from '@/lib/modules'
import { margin } from './cost-math'

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

export interface CostSettings {
  markupPercent: number
  baseCurrency: string
  secondaryCurrency: string | null
  // Businesses that import are quoted one figure for shipping and duties and pay one figure, so the
  // card asks once rather than asking the owner to split what nobody split for them. Gated by the
  // `landed_cost` module, and delivered through this endpoint for the same reason everything else on
  // this card is: the endpoint is the authority, and a prop threaded down from the page would be a
  // second copy of the rule free to drift.
  //
  // INPUT ONLY. shipping_cost and tariff_cost remain separate columns — tariff is precisely what gets
  // broken back out for customs paperwork, and dropping it would be irreversible.
  combineShippingAndDuties: boolean
}

export interface ProductCost {
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

// Which thing a cost row describes. Both live in one table, so the formula, the RLS policy and the
// endpoint stay single-sourced — the reason this isn't a second table.
export type CostTarget = { kind: 'product'; id: string } | { kind: 'variant'; id: string }

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
  costPrimary: r.cost_primary === null || r.cost_primary === undefined ? null : Number(r.cost_primary),
  costSecondary: r.cost_secondary === null || r.cost_secondary === undefined ? null : Number(r.cost_secondary),
  shippingCost: Number(r.shipping_cost ?? 0),
  tariffCost: Number(r.tariff_cost ?? 0),
  markupPercent: Number(r.markup_percent ?? 0),
  computedCost: r.computed_cost === null || r.computed_cost === undefined ? null : Number(r.computed_cost),
  updatedAt: (r.updated_at as string) ?? null,
})

// Margin and the landed-cost formula now live in ./cost-math, isomorphic, so the client card and the
// invoice approval preview compute exactly what this computes and what the generated column stores.

// The tenant's own defaults. Nothing here is assumed: a tenant with no secondary currency gets null and
// never sees that field.
export async function getCostSettings(tenantId: string): Promise<CostSettings> {
  const { data } = await createAdminClient()
    .from('tenants').select('cost_markup_percent, cost_base_currency, cost_secondary_currency, enabled_modules')
    .eq('id', tenantId).maybeSingle()
  return {
    markupPercent: Number(data?.cost_markup_percent ?? 10),
    baseCurrency: (data?.cost_base_currency as string) || 'USD',
    secondaryCurrency: (data?.cost_secondary_currency as string) || null,
    combineShippingAndDuties: enabledModulesOf(data ?? {}).includes('landed_cost'),
  }
}

// Settings alone, for a screen that has no product to ask about yet — the Add form. Goes through the
// same gate as every other cost read, so a session that may not see costs gets 'forbidden' here
// exactly as it would from a product's cost endpoint, and the card stays absent for the same reason.
export async function getCostSettingsForSession(): Promise<CostResult<CostSettings>> {
  const a = await costAccess()
  if (a === 'not_found' || a === 'forbidden') return { ok: false, reason: a }
  return { ok: true, data: await getCostSettings(a.tenantId) }
}

// Create a product and, if one was entered, its cost — in a single transaction.
//
// The whole reason this is one database call: two writes across two HTTP calls cannot be atomic, and a
// cost lost after a successful product insert is the failure worth designing against. See
// add_product_with_cost_rpc.sql, which also documents why this path uses the admin client while every
// other cost write goes through the RLS-scoped one.
//
// Returns 'forbidden' if a cost is supplied by a session that may not record costs — the product is
// not created either, because silently dropping the cost is the thing this exists to prevent.
export async function createProductWithCost(
  tenantId: string,
  product: Record<string, unknown>,
  cost: CostInput | null,
  actorUserId: string | null,
): Promise<CostResult<Record<string, unknown>>> {
  if (cost) {
    const a = await costAccess()
    if (a === 'not_found' || a === 'forbidden') return { ok: false, reason: a }
    if (a.tenantId !== tenantId) return { ok: false, reason: 'forbidden' }
  }

  const { data, error } = await createAdminClient().rpc('create_product_with_cost', {
    p_tenant: tenantId,
    p_product: product,
    p_cost: cost ?? null,
    p_actor: actorUserId,
  })
  if (error) throw new Error(error.message)
  // The function returns the product row; PostgREST hands back a record, not an array.
  return { ok: true, data: (Array.isArray(data) ? data[0] : data) as Record<string, unknown> }
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

// The selling price the margin is measured against. For a sub-product that is the SUB-PRODUCT's own
// price — a variant priced at 3,500 must never be scored against its parent's 8,000.
async function targetPrice(tenantId: string, target: CostTarget): Promise<number | null | 'missing'> {
  const db = createAdminClient()
  if (target.kind === 'product') {
    const { data } = await db.from('catalog_products').select('price').eq('tenant_id', tenantId).eq('id', target.id).maybeSingle()
    if (!data) return 'missing'
    return data.price === null || data.price === undefined ? null : Number(data.price)
  }
  // A variant with no price of its own falls back to its parent product's base price, which is the rule
  // the rest of the app already uses to decide what a sub-product sells for.
  const { data } = await db.from('studio_variants')
    .select('price, studio_products!inner(base_price)').eq('tenant_id', tenantId).eq('id', target.id).maybeSingle()
  if (!data) return 'missing'
  const own = data.price
  if (own !== null && own !== undefined) return Number(own)
  const parent = (data as unknown as { studio_products?: { base_price: number | null } }).studio_products?.base_price
  return parent === null || parent === undefined ? null : Number(parent)
}

const targetColumn = (t: CostTarget) => (t.kind === 'product' ? 'product_id' : 'variant_id')

export async function getCost(target: CostTarget): Promise<CostResult<ProductCostView>> {
  const a = await costAccess()
  if (a === 'not_found' || a === 'forbidden') return { ok: false, reason: a }

  const price = await targetPrice(a.tenantId, target)
  if (price === 'missing') return { ok: false, reason: 'not_found' }

  // RLS-scoped client for the cost itself, so the policy actually runs.
  const sb = await createClient()
  const { data } = await sb.from('product_costs').select('*').eq(targetColumn(target), target.id).maybeSingle()
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
export async function saveCost(target: CostTarget, input: CostInput): Promise<CostResult<ProductCostView>> {
  const a = await costAccess()
  if (a === 'not_found' || a === 'forbidden') return { ok: false, reason: a }

  // Confirm the target belongs to this tenant before writing. The composite foreign key enforces the
  // same thing in the database; this is here so a wrong id answers 404 rather than a constraint error.
  if (await targetPrice(a.tenantId, target) === 'missing') return { ok: false, reason: 'not_found' }

  const col = targetColumn(target)
  const sb = await createClient()
  const { data: existing } = await sb.from('product_costs').select('id, markup_percent').eq(col, target.id).maybeSingle()
  // Keep the markup already snapshotted on an existing row; only a brand-new row takes today's default.
  // Identical for a variant — the snapshot rule doesn't change with what the row describes.
  const markup = existing ? Number(existing.markup_percent) : (await getCostSettings(a.tenantId)).markupPercent

  const fields = {
    cost_primary: input.costPrimary ?? null,
    cost_secondary: input.costSecondary ?? null,
    shipping_cost: input.shippingCost ?? 0,
    tariff_cost: input.tariffCost ?? 0,
    markup_percent: markup,
    updated_at: new Date().toISOString(),
    updated_by: a.actorUserId,
  }

  // Explicit update-or-insert rather than an upsert. Uniqueness here is enforced by two PARTIAL indexes
  // (one per target column, each `WHERE … IS NOT NULL`), and an ON CONFLICT target has to repeat that
  // predicate to match — which PostgREST cannot express. Asking it to upsert produced "no unique or
  // exclusion constraint matching the ON CONFLICT specification" and wrote nothing at all.
  if (existing) {
    const { error } = await sb.from('product_costs').update(fields).eq('id', existing.id as string)
    if (error) throw new Error(error.message)
    return getCost(target)
  }

  const { error } = await sb.from('product_costs').insert({
    tenant_id: a.tenantId,
    product_id: target.kind === 'product' ? target.id : null,
    variant_id: target.kind === 'variant' ? target.id : null,
    ...fields,
  })
  // 23505: another request inserted the row between the read above and this write. The partial index did
  // its job; finish as an update rather than failing a save the user has every reason to expect to work.
  if (error?.code === '23505') {
    const { data: raced } = await sb.from('product_costs').select('id').eq(col, target.id).maybeSingle()
    if (raced) {
      const { error: e2 } = await sb.from('product_costs').update(fields).eq('id', raced.id as string)
      if (e2) throw new Error(e2.message)
      return getCost(target)
    }
  }
  if (error) throw new Error(error.message)

  return getCost(target)
}

// Re-snapshot a single product onto the tenant's CURRENT default markup — an explicit act, never a
// side effect of changing the default.
export async function applyCurrentMarkup(target: CostTarget): Promise<CostResult<ProductCostView>> {
  const a = await costAccess()
  if (a === 'not_found' || a === 'forbidden') return { ok: false, reason: a }
  const sb = await createClient()
  const { error } = await sb.from('product_costs')
    .update({ markup_percent: (await getCostSettings(a.tenantId)).markupPercent, updated_at: new Date().toISOString(), updated_by: a.actorUserId })
    .eq(targetColumn(target), target.id)
  if (error) throw new Error(error.message)
  return getCost(target)
}

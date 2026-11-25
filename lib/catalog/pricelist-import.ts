import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { getCostSettings } from './costs'

// ── A SUPPLIER PRICE LIST, IN BULK ──────────────────────────────────────────────────────────────────
//
// A supplier's yearly price list is thousands of products, each with what the supplier charges for it.
// Typing them is not a plan, and the CSV upload cannot carry a cost or a sub-product. This takes a
// prepared file (one JSON document, sent in chunks by the page) and writes the same rows the Add form
// writes: a catalog product, its Studio counterpart, its sub-products where the list prices a product
// per fabric category, and a cost row for whichever of those the price belongs to.
//
// THE PRICE IS A COST, IN THE SUPPLIER'S CURRENCY — and where it lands follows the business's own cost
// settings rather than an assumption made here. product_costs keeps two figures: cost_primary, what
// was paid in the business's base currency, and cost_secondary, the supplier's own amount, never
// converted. A list priced in the base currency goes in the first; one priced in the business's
// secondary currency goes in the second and leaves the first empty, because no rate is stored
// anywhere and a guessed one would be a wrong one. A currency that is neither is refused.
//
// SAFE TO RUN TWICE. A product this business already has under the same SKU and name is skipped, so a
// chunk that timed out can simply be sent again.

const variantSchema = z.object({
  label: z.string().min(1).max(200),
  fabricCategory: z.string().max(40).nullable().optional(),
  cost: z.number().nonnegative().nullable(),
})
const itemSchema = z.object({
  sku: z.string().min(1).max(80),
  name: z.string().min(1).max(300),
  brand: z.string().max(120).nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  measurements: z.string().max(300).nullable().optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  internalNotes: z.string().max(2000).nullable().optional(),
  cost: z.number().nonnegative().nullable(),
  variants: z.array(variantSchema).max(12).optional(),
})
export const priceListChunkSchema = z.object({
  currency: z.string().length(3),
  dryRun: z.boolean().optional(),
  items: z.array(itemSchema).min(1).max(200),
})
export type PriceListChunk = z.infer<typeof priceListChunkSchema>
type Item = PriceListChunk['items'][number]

export type CostColumn = 'cost_primary' | 'cost_secondary'
export interface PriceListResult {
  ok: boolean
  error?: string
  /** Where the list's prices are written, or null when its currency is neither of the business's. */
  costColumn: CostColumn | null
  baseCurrency: string
  secondaryCurrency: string | null
  received: number
  created: number
  skipped: number
  variants: number
  costs: number
}

/** Which cost column a list in `currency` belongs in for a business with these settings. Pure. */
export function costColumnFor(currency: string, base: string, secondary: string | null): CostColumn | null {
  const c = currency.toUpperCase()
  if (c === base.toUpperCase()) return 'cost_primary'
  if (secondary && c === secondary.toUpperCase()) return 'cost_secondary'
  return null
}

const keyOf = (sku: string, name: string) => `${sku.trim()}|${name.trim().toLowerCase()}`

export async function importPriceListChunk(tenantId: string, actorUserId: string, chunk: PriceListChunk): Promise<PriceListResult> {
  const db = createAdminClient()
  const settings = await getCostSettings(tenantId)
  const costColumn = costColumnFor(chunk.currency, settings.baseCurrency, settings.secondaryCurrency)
  const base: PriceListResult = {
    ok: true, costColumn, baseCurrency: settings.baseCurrency, secondaryCurrency: settings.secondaryCurrency,
    received: chunk.items.length, created: 0, skipped: 0, variants: 0, costs: 0,
  }

  // The same product twice in one chunk is one product.
  const unique = new Map<string, Item>()
  for (const it of chunk.items) if (!unique.has(keyOf(it.sku, it.name))) unique.set(keyOf(it.sku, it.name), it)

  const skus = [...new Set([...unique.values()].map((i) => i.sku.trim()))]
  const { data: existing, error: readErr } = await db.from('catalog_products')
    .select('sku, name').eq('tenant_id', tenantId).in('sku', skus)
  if (readErr) return { ...base, ok: false, error: readErr.message }
  const have = new Set((existing ?? []).map((r) => keyOf(String(r.sku ?? ''), String(r.name ?? ''))))
  const fresh = [...unique.entries()].filter(([k]) => !have.has(k)).map(([, it]) => it)
  base.skipped = chunk.items.length - fresh.length

  if (chunk.dryRun) {
    return {
      ...base,
      created: fresh.length,
      variants: fresh.reduce((n, i) => n + (i.variants?.length ?? 0), 0),
      costs: costColumn ? fresh.reduce((n, i) => n + (i.variants?.length ? i.variants.filter((v) => v.cost !== null).length : i.cost !== null ? 1 : 0), 0) : 0,
    }
  }
  if (!costColumn) {
    return { ...base, ok: false, error: `This price list is in ${chunk.currency}, and this business's cost settings use ${settings.baseCurrency}${settings.secondaryCurrency ? ` and ${settings.secondaryCurrency}` : ''}. Set ${chunk.currency} as the second currency in cost settings first.` }
  }
  if (!fresh.length) return base

  const now = new Date().toISOString()
  // Our own token per row, so what comes back can be matched to what went in without trusting order.
  const staged = fresh.map((it) => ({ it, token: randomUUID() }))
  const { data: products, error: insErr } = await db.from('catalog_products').insert(staged.map(({ it, token }) => ({
    tenant_id: tenantId,
    name: it.name.trim(),
    sku: it.sku.trim(),
    brand: it.brand?.trim() || null,
    category: it.category?.trim() || null,
    description: it.description?.trim() || null,
    measurements: it.measurements?.trim() || null,
    price: null,
    status: 'active',
    // A supplier's list is what CAN be ordered, not what is on the floor.
    availability_status: 'special_order',
    showroom_quantity: 0, warehouse_quantity: 0, storage_quantity: 0, incoming_quantity: 0,
    tags: it.tags ?? [],
    internal_notes: it.internalNotes?.trim() || null,
    qr_code_token: token,
    created_at: now, updated_at: now,
  }))).select('id, qr_code_token')
  if (insErr || !products) return { ...base, ok: false, error: insErr?.message ?? 'Could not save the products.' }

  const idByToken = new Map(products.map((p) => [p.qr_code_token as string, p.id as string]))
  const ids = products.map((p) => p.id as string)
  // Anything below failing takes this chunk's products back out, so a chunk is all there or not there
  // and sending it again starts clean.
  const undo = async (message: string): Promise<PriceListResult> => {
    await db.from('studio_products').delete().eq('tenant_id', tenantId).in('catalog_product_id', ids)
    await db.from('catalog_products').delete().eq('tenant_id', tenantId).in('id', ids)
    return { ...base, ok: false, error: message }
  }

  // The Studio counterpart every product gets from the Add form (lib/studio/link.ts).
  const { data: studio, error: stErr } = await db.from('studio_products').insert(staged.map(({ it, token }) => ({
    tenant_id: tenantId, catalog_product_id: idByToken.get(token)!,
    name: it.name.trim(), category: it.category?.trim() || null, description: it.description?.trim() || null,
    base_price: null, photos: [],
  }))).select('id, catalog_product_id')
  if (stErr || !studio) return undo(stErr?.message ?? 'Could not create the Studio products.')
  const studioByCatalog = new Map(studio.map((s) => [s.catalog_product_id as string, s.id as string]))

  const costRows: Array<Record<string, unknown>> = []
  const costRow = (target: { product_id: string | null; variant_id: string | null }, amount: number) => ({
    tenant_id: tenantId, ...target,
    cost_primary: costColumn === 'cost_primary' ? amount : null,
    cost_secondary: costColumn === 'cost_secondary' ? amount : null,
    shipping_cost: 0, tariff_cost: 0,
    markup_percent: settings.markupPercent, commission_percent: settings.commissionPercent,
    updated_at: now, updated_by: actorUserId,
  })

  const variantStage: Array<{ token: string; cost: number | null; row: Record<string, unknown> }> = []
  for (const { it, token } of staged) {
    const productId = idByToken.get(token)!
    if (!it.variants?.length) {
      if (it.cost !== null) costRows.push(costRow({ product_id: productId, variant_id: null }, it.cost))
      continue
    }
    it.variants.forEach((v, position) => {
      const vt = randomUUID()
      variantStage.push({
        token: vt, cost: v.cost,
        row: {
          tenant_id: tenantId, product_id: studioByCatalog.get(productId)!,
          name: v.label.trim(), label: v.label.trim(), sku: it.sku.trim(),
          attributes: v.fabricCategory ? { fabric_category: v.fabricCategory } : {},
          fabric_category: v.fabricCategory ?? null,
          price: null, position, qr_token: vt,
        },
      })
    })
  }
  if (variantStage.length) {
    const { data: vs, error: vErr } = await db.from('studio_variants').insert(variantStage.map((v) => v.row)).select('id, qr_token')
    if (vErr || !vs) return undo(vErr?.message ?? 'Could not create the sub-products.')
    const idByQr = new Map(vs.map((v) => [v.qr_token as string, v.id as string]))
    for (const v of variantStage) if (v.cost !== null) costRows.push(costRow({ product_id: null, variant_id: idByQr.get(v.token)! }, v.cost))
  }
  if (costRows.length) {
    const { error: cErr } = await db.from('product_costs').insert(costRows)
    if (cErr) return undo(cErr.message)
  }
  return { ...base, created: ids.length, variants: variantStage.length, costs: costRows.length }
}

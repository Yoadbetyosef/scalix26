import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from './session'

// Sub-products for the catalog list, fetched for every product at once.
//
// The link is a real foreign-key path, not a name match: catalog_products.id ←
// studio_products.catalog_product_id, and studio_variants.product_id → studio_products.id. PostgREST
// can traverse it in a single request, so the whole list costs one round trip no matter how many
// products are on screen — the alternative, a query per row, is the thing this exists to avoid.
//
// A tenant without the Studio module simply has no studio_products rows, so this returns {} and the
// list renders exactly as it does today. That is the intended behaviour, not a special case: there is
// nothing to hide because there is nothing to show.

export interface CatalogVariant { id: string; name: string; sku: string | null; price: number | null }

// Keyed by catalog_products.id.
export type VariantsByProduct = Record<string, CatalogVariant[]>

interface Row {
  id: string; name: string | null; label: string | null; sku: string | null; price: number | null
  studio_products: { catalog_product_id: string | null } | null
}

export async function getVariantsByProduct(): Promise<VariantsByProduct> {
  const s = await requireCatalogTenant()
  if (!s) return {}

  const { data, error } = await createAdminClient()
    .from('studio_variants')
    // !inner drops any variant whose Studio product isn't linked to a catalog row — it has no product
    // in this list to nest under, so carrying it would only cost bytes.
    .select('id, name, label, sku, price, position, studio_products!inner(catalog_product_id)')
    .eq('tenant_id', s.tenantId)
    .not('studio_products.catalog_product_id', 'is', null)
    .order('position')
    .limit(2000)
  if (error) return {}

  const out: VariantsByProduct = {}
  for (const r of ((data as unknown as Row[] | null) ?? [])) {
    const productId = r.studio_products?.catalog_product_id
    if (!productId) continue
    // Same display rule the rest of the app uses: its own name, else its label.
    const name = (r.name || r.label || 'Sub-product').trim()
    ;(out[productId] ??= []).push({
      id: r.id,
      name,
      sku: r.sku || null,
      price: r.price === null || r.price === undefined ? null : Number(r.price),
    })
  }
  return out
}

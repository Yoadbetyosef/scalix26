import { createAdminClient } from '@/lib/supabase/server'

// Core product LIST over the shared product spine (catalog_products) — the same rows the legacy /catalog
// screen uses, so a tenant's existing products appear in the new /commerce UI with no migration. Adds Core
// satellite counts (variants/components). Tenant-scoped (admin client + explicit tenant_id). NOTE: base
// price on catalog_products is numeric(12,2) DOLLARS (legacy), distinct from the integer-cents used by
// variants/sales/payments — surfaced as-is, never silently converted.
const admin = () => createAdminClient()

export interface ProductListItem {
  id: string; name: string; sku: string | null; category: string | null
  price: number | null; status: string; image_url: string | null; updated_at: string
  variantCount: number; componentCount: number
}

export async function listProducts(tenantId: string, limit = 500): Promise<ProductListItem[]> {
  const { data: products } = await admin().from('catalog_products')
    .select('id, name, sku, category, price, status, image_url, updated_at')
    .eq('tenant_id', tenantId).order('updated_at', { ascending: false }).limit(limit)
  const rows = (products ?? []) as Array<Omit<ProductListItem, 'variantCount' | 'componentCount'>>
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const [{ data: vars }, { data: comps }] = await Promise.all([
    admin().from('product_variants').select('product_id').eq('tenant_id', tenantId).in('product_id', ids),
    admin().from('product_components').select('product_id').eq('tenant_id', tenantId).in('product_id', ids),
  ])
  const vc = tally(vars), cc = tally(comps)
  return rows.map((r) => ({ ...r, variantCount: vc.get(r.id) ?? 0, componentCount: cc.get(r.id) ?? 0 }))
}

function tally(rows: Array<{ product_id: string }> | null): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows ?? []) m.set(r.product_id, (m.get(r.product_id) ?? 0) + 1)
  return m
}

import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from './session'

// The tenant's own list of product names, behind the Add Product form's suggest-as-you-type field.
// Choosing a name also carries its category across, so the two fields can't disagree.

export interface ProductNameSuggestion { id: string; name: string; category: string | null }

const row = (r: Record<string, unknown>): ProductNameSuggestion => ({
  id: r.id as string, name: r.name as string, category: (r.category as string) ?? null,
})

// `q` empty → the whole list, so the field can also be browsed as a plain dropdown before typing.
// Ordered by category then name, which is how the list reads on paper.
export async function searchProductNames(q: string, limit = 400): Promise<ProductNameSuggestion[]> {
  const s = await requireCatalogTenant(); if (!s) return []
  const db = createAdminClient()
  let query = db.from('catalog_product_names')
    .select('id, name, category')
    .eq('tenant_id', s.tenantId).eq('active', true)

  const term = q.trim()
  if (term) {
    // Escape PostgREST's pattern wildcards so a stray % can't turn into "match everything".
    const safe = term.replace(/[%,()\\]/g, ' ').trim()
    if (safe) query = query.ilike('name', `%${safe}%`)
  }
  const { data } = await query.order('category', { ascending: true, nullsFirst: false }).order('name').limit(limit)
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(row)
}

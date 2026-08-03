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

// ── Managing the list ───────────────────────────────────────────────────────────────────────────────
// The business owns this list outright: it adds, renames, re-categorises, hides and deletes without a
// developer. Every call re-resolves the tenant from the session; an id is never trusted from the client.

export interface ProductNameRow extends ProductNameSuggestion { active: boolean }
const fullRow = (r: Record<string, unknown>): ProductNameRow => ({ ...row(r), active: r.active !== false })

// The manager sees hidden entries too, so a name retired by mistake can be brought back.
export async function listAllProductNames(): Promise<ProductNameRow[]> {
  const s = await requireCatalogTenant(); if (!s) return []
  const db = createAdminClient()
  const { data } = await db.from('catalog_product_names')
    .select('id, name, category, active')
    .eq('tenant_id', s.tenantId)
    .order('category', { ascending: true, nullsFirst: false }).order('name').limit(5000)
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(fullRow)
}

const DUPLICATE = '23505'

export async function addProductName(name: string, category: string | null): Promise<{ ok: boolean; error?: string; item?: ProductNameRow }> {
  const s = await requireCatalogTenant(); if (!s) return { ok: false, error: 'unauthorized' }
  const clean = name.trim()
  if (!clean) return { ok: false, error: 'Enter a product name.' }
  const db = createAdminClient()
  const { data, error } = await db.from('catalog_product_names')
    .insert({ tenant_id: s.tenantId, name: clean, category: category?.trim() || null, active: true })
    .select('id, name, category, active').single()
  if (error) return { ok: false, error: error.code === DUPLICATE ? `"${clean}" is already on the list.` : error.message }
  return { ok: true, item: fullRow(data as Record<string, unknown>) }
}

export async function updateProductName(id: string, patch: { name?: string; category?: string | null; active?: boolean }): Promise<{ ok: boolean; error?: string }> {
  const s = await requireCatalogTenant(); if (!s) return { ok: false, error: 'unauthorized' }
  const m: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const clean = patch.name.trim()
    if (!clean) return { ok: false, error: 'Enter a product name.' }
    m.name = clean
  }
  if (patch.category !== undefined) m.category = patch.category?.trim() || null
  if (patch.active !== undefined) m.active = patch.active
  if (!Object.keys(m).length) return { ok: true }
  const db = createAdminClient()
  const { error } = await db.from('catalog_product_names').update(m).eq('tenant_id', s.tenantId).eq('id', id)
  if (error) return { ok: false, error: error.code === DUPLICATE ? 'Another entry already has that name.' : error.message }
  return { ok: true }
}

// Hard delete. Products already created keep their own name column, so removing an entry only takes it
// out of the suggestions — it never touches the catalog.
export async function deleteProductName(id: string): Promise<boolean> {
  const s = await requireCatalogTenant(); if (!s) return false
  const db = createAdminClient()
  const { error } = await db.from('catalog_product_names').delete().eq('tenant_id', s.tenantId).eq('id', id)
  return !error
}

export interface BulkResult { added: number; skipped: number }

// Paste a column straight out of a spreadsheet: one name per line, all into one category. Names already
// on the list are skipped rather than erroring, so pasting an updated full list is a safe way to top up.
export async function addProductNamesBulk(text: string, category: string | null): Promise<{ ok: boolean; error?: string; result?: BulkResult }> {
  const s = await requireCatalogTenant(); if (!s) return { ok: false, error: 'unauthorized' }
  const wanted: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    // Tolerate a pasted 2-column selection — take the first cell.
    const name = raw.split('\t')[0].trim().replace(/\s+/g, ' ')
    if (!name) continue
    const k = name.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k); wanted.push(name)
  }
  if (!wanted.length) return { ok: false, error: 'Nothing to add — paste one product name per line.' }
  if (wanted.length > 2000) return { ok: false, error: 'That is more than 2000 names; split it into smaller batches.' }

  const db = createAdminClient()
  // Diff here rather than relying on ON CONFLICT: uniqueness is an expression index on lower(name),
  // which PostgREST cannot reference — and comparing here is what makes the match case-insensitive.
  const { data: existing } = await db.from('catalog_product_names').select('name').eq('tenant_id', s.tenantId)
  const have = new Set(((existing as Array<{ name: string }> | null) ?? []).map((r) => r.name.trim().toLowerCase()))
  const fresh = wanted.filter((n) => !have.has(n.toLowerCase()))
  if (!fresh.length) return { ok: true, result: { added: 0, skipped: wanted.length } }

  const { error } = await db.from('catalog_product_names')
    .insert(fresh.map((name) => ({ tenant_id: s.tenantId, name, category: category?.trim() || null, active: true })))
  if (error) return { ok: false, error: error.message }
  return { ok: true, result: { added: fresh.length, skipped: wanted.length - fresh.length } }
}

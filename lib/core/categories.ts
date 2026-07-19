import { createAdminClient } from '@/lib/supabase/server'
import { normalizeCategoryName } from './category-util'

// Tenant-managed product categories. The product's category NAME still lives on catalog_products.category
// (text) so all existing readers keep working; this table is the managed vocabulary. Rename propagates to
// products; archive hides a category from selection but leaves it on products; delete is allowed only when
// no product uses it. Tenant-scoped throughout (admin client + explicit tenant_id).
const admin = () => createAdminClient()
const COLS = 'id, tenant_id, name, group_label, sort_order, archived_at, source_package_id'

export interface CategoryRow { id: string; tenant_id: string; name: string; group_label: string | null; sort_order: number; archived_at: string | null; source_package_id: string | null }

export async function listCategories(tenantId: string, opts: { includeArchived?: boolean } = {}): Promise<CategoryRow[]> {
  let q = admin().from('product_categories').select(COLS).eq('tenant_id', tenantId)
  if (!opts.includeArchived) q = q.is('archived_at', null)
  const { data } = await q.order('sort_order').order('name')
  return (data as CategoryRow[]) ?? []
}

export async function createCategory(tenantId: string, name: string, opts: { groupLabel?: string | null; sourcePackageId?: string | null } = {}): Promise<{ ok: true; category: CategoryRow } | { ok: false; error: string }> {
  const clean = normalizeCategoryName(name)
  if (!clean) return { ok: false, error: 'name_required' }
  const { count } = await admin().from('product_categories').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
  const { data, error } = await admin().from('product_categories').insert({
    tenant_id: tenantId, name: clean, group_label: opts.groupLabel ?? null, sort_order: count ?? 0, source_package_id: opts.sourcePackageId ?? null,
  }).select(COLS).single()
  if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? 'duplicate' : error.message }
  return { ok: true, category: data as CategoryRow }
}

// Rename + propagate the new name to every product currently using the old name (keeps products in sync).
export async function renameCategory(tenantId: string, id: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = normalizeCategoryName(name)
  if (!clean) return { ok: false, error: 'name_required' }
  const { data: cur } = await admin().from('product_categories').select('name').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!cur) return { ok: false, error: 'not_found' }
  if (cur.name === clean) return { ok: true }
  const { error } = await admin().from('product_categories').update({ name: clean, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id)
  if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? 'duplicate' : error.message }
  await admin().from('catalog_products').update({ category: clean, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('category', cur.name)
  return { ok: true }
}

export async function setCategoryArchived(tenantId: string, id: string, archived: boolean): Promise<boolean> {
  const { error } = await admin().from('product_categories').update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id)
  return !error
}

// Set sort_order from a full ordered id list (Settings sends the list after a move). Tenant-scoped per row.
export async function reorderCategories(tenantId: string, ids: string[]): Promise<boolean> {
  for (let i = 0; i < ids.length; i++) await admin().from('product_categories').update({ sort_order: i, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', ids[i])
  return true
}

// How many products currently use this category name (used to guard delete).
export async function categoryUsage(tenantId: string, name: string): Promise<number> {
  const { count } = await admin().from('catalog_products').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('category', name)
  return count ?? 0
}

// Hard delete — ONLY when no product uses the category. In-use categories must be archived, never deleted.
export async function deleteCategory(tenantId: string, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: cat } = await admin().from('product_categories').select('name').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!cat) return { ok: false, error: 'not_found' }
  if ((await categoryUsage(tenantId, cat.name)) > 0) return { ok: false, error: 'in_use' }
  const { error } = await admin().from('product_categories').delete().eq('tenant_id', tenantId).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

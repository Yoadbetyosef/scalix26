import { createAdminClient } from '@/lib/supabase/server'
import type { ProductInput, ProductUpdate } from './product-input'

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
    .eq('tenant_id', tenantId).is('archived_at', null).is('deleted_at', null)
    .order('updated_at', { ascending: false }).limit(limit)
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

export interface ProductRecord {
  id: string; tenant_id: string; name: string; sku: string | null; category: string | null; brand: string | null
  price: number | null; status: string; description: string | null; image_url: string | null
  created_at: string; updated_at: string
}
const PRODUCT_COLS = 'id, tenant_id, name, sku, category, brand, price, status, description, image_url, created_at, updated_at'

// A single product (the General/header data). Tenant-scoped — returns null for another tenant's id.
export async function getProduct(tenantId: string, id: string): Promise<ProductRecord | null> {
  const { data } = await admin().from('catalog_products').select(PRODUCT_COLS).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  return (data as ProductRecord | null) ?? null
}

export async function createProduct(tenantId: string, input: ProductInput): Promise<{ ok: true; product: ProductRecord } | { ok: false; error: string }> {
  const { data, error } = await admin().from('catalog_products').insert({ tenant_id: tenantId, ...cleanInput(input) }).select(PRODUCT_COLS).single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, product: data as ProductRecord }
}

// Update General fields. Scoped by tenant so a browser can never patch another tenant's product.
export async function updateProduct(tenantId: string, id: string, patch: ProductUpdate): Promise<{ ok: true; product: ProductRecord } | { ok: false; error: string }> {
  const clean = cleanInput(patch)
  if (!Object.keys(clean).length) return { ok: false, error: 'empty_update' }
  const { data, error } = await admin().from('catalog_products').update({ ...clean, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).select(PRODUCT_COLS).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'not_found' }
  return { ok: true, product: data as ProductRecord }
}

// Archive/restore a whole product — reversible; hidden from the active catalog + new selection, kept in history.
export async function archiveProduct(tenantId: string, id: string, archived: boolean): Promise<boolean> {
  const { error } = await admin().from('catalog_products').update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id)
  return !error
}

// Safe delete: if the product OR any of its components is referenced by historical document lines, TOMBSTONE
// it (soft delete — references + history preserved). Otherwise hard-delete (CASCADE removes components/
// variants/media). Either way it leaves the active catalog. Tenant-scoped.
export async function deleteProduct(tenantId: string, id: string): Promise<{ ok: true; mode: 'soft' | 'hard' } | { ok: false; error: string }> {
  const { data: prod } = await admin().from('catalog_products').select('id').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!prod) return { ok: false, error: 'not_found' }
  const { data: comps } = await admin().from('product_components').select('id').eq('tenant_id', tenantId).eq('product_id', id)
  const compIds = (comps ?? []).map((c) => c.id as string)
  const { count: byProduct } = await admin().from('sales_document_lines').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('product_id', id)
  let referenced = (byProduct ?? 0) > 0
  if (!referenced && compIds.length) {
    const { count: byComp } = await admin().from('sales_document_lines').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('component_id', compIds)
    referenced = (byComp ?? 0) > 0
  }
  if (referenced) {
    const { error } = await admin().from('catalog_products').update({ deleted_at: new Date().toISOString(), status: 'discontinued', updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id)
    return error ? { ok: false, error: error.message } : { ok: true, mode: 'soft' }
  }
  const { error } = await admin().from('catalog_products').delete().eq('tenant_id', tenantId).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true, mode: 'hard' }
}

// Map validated input → catalog_products columns, coercing '' → null (never write empty strings).
function cleanInput(input: ProductInput | ProductUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const put = (k: string, v: unknown) => { if (v !== undefined) out[k] = v === '' ? null : v }
  put('name', input.name); put('sku', input.sku); put('category', input.category); put('brand', input.brand)
  put('price', input.price); put('status', input.status); put('description', input.description); put('image_url', input.image_url)
  return out
}


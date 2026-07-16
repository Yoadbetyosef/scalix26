import { createClient } from '@/lib/supabase/server'
import { requireCommerceAccess } from './guard'
import { addCommerceEvent } from './events'
import type { CommerceProduct, ProductInput } from './types'

const row = (r: Record<string, unknown>): CommerceProduct => ({
  id: r.id as string,
  name: r.name as string,
  internalName: (r.internal_name as string) ?? null,
  description: (r.description as string) ?? null,
  productType: r.product_type as CommerceProduct['productType'],
  category: (r.category as string) ?? null,
  collection: (r.collection as string) ?? null,
  brand: (r.brand as string) ?? null,
  status: r.status as CommerceProduct['status'],
  coverImage: (r.cover_image as string) ?? null,
  sku: (r.sku as string) ?? null,
  cost: r.cost != null ? Number(r.cost) : null,
  defaultPrice: r.default_price != null ? Number(r.default_price) : null,
  leadTimeDays: r.lead_time_days != null ? Number(r.lead_time_days) : null,
  tags: (r.tags as string[]) ?? [],
  archivedAt: (r.archived_at as string) ?? null,
  createdAt: r.created_at as string,
})

const SELECT = 'id,name,internal_name,description,product_type,category,collection,brand,status,cover_image,sku,cost,default_price,lead_time_days,tags,archived_at,created_at'

// List catalog products for the active tenant. Draft products are excluded unless includeDrafts is set
// (only a user with catalog.manage should pass that — enforced at the route). Archived always excluded
// from the default catalog but preserved for historical orders.
export async function listProducts(opts: { includeDrafts?: boolean; type?: string; search?: string } = {}): Promise<CommerceProduct[]> {
  const c = await requireCommerceAccess(); if (!c) return []
  const sb = await createClient()
  let q = sb.from('commerce_products').select(SELECT).eq('tenant_id', c.tenantId).is('archived_at', null).order('created_at', { ascending: false }).limit(200)
  if (!opts.includeDrafts) q = q.neq('status', 'draft')
  if (opts.type) q = q.eq('product_type', opts.type)
  if (opts.search) q = q.ilike('name', `%${opts.search}%`)
  const { data } = await q
  return ((data as Array<Record<string, unknown>>) ?? []).map(row)
}

export async function getProduct(id: string): Promise<CommerceProduct | null> {
  const c = await requireCommerceAccess(); if (!c) return null
  const sb = await createClient()
  const { data } = await sb.from('commerce_products').select(SELECT).eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  return data ? row(data as Record<string, unknown>) : null
}

export async function createProduct(input: ProductInput): Promise<{ ok: true; product: CommerceProduct } | { ok: false; error: string }> {
  const c = await requireCommerceAccess(); if (!c) return { ok: false, error: 'unauthorized' }
  const sb = await createClient()
  const { data, error } = await sb.from('commerce_products').insert({
    tenant_id: c.tenantId,
    name: input.name.trim(),
    internal_name: input.internalName ?? null,
    description: input.description ?? null,
    product_type: input.productType ?? 'simple_product',
    category: input.category ?? null,
    collection: input.collection ?? null,
    brand: input.brand ?? null,
    status: input.status ?? 'draft',
    cover_image: input.coverImage ?? null,
    sku: input.sku?.trim() || null,
    cost: input.cost ?? null,
    default_price: input.defaultPrice ?? null,
    lead_time_days: input.leadTimeDays ?? null,
    tags: input.tags ?? [],
    created_by: c.actor,
  }).select(SELECT).single()
  if (error) {
    return { ok: false, error: error.code === '23505' ? 'That SKU is already in use. Choose a different one.' : error.message }
  }
  const product = row(data as Record<string, unknown>)
  await addCommerceEvent(c.tenantId, 'product', product.id, 'created', { name: product.name, productType: product.productType }, c.actor)
  return { ok: true, product }
}

export async function updateProduct(id: string, patch: ProductInput): Promise<{ ok: true; product: CommerceProduct } | { ok: false; error: string }> {
  const c = await requireCommerceAccess(); if (!c) return { ok: false, error: 'unauthorized' }
  const sb = await createClient()
  const m: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const map: Record<string, string> = { name: 'name', internalName: 'internal_name', description: 'description', productType: 'product_type', category: 'category', collection: 'collection', brand: 'brand', status: 'status', coverImage: 'cover_image', sku: 'sku', cost: 'cost', defaultPrice: 'default_price', leadTimeDays: 'lead_time_days', tags: 'tags' }
  for (const [k, col] of Object.entries(map)) if (k in patch) m[col] = (patch as unknown as Record<string, unknown>)[k]
  if (typeof m.sku === 'string') m.sku = (m.sku as string).trim() || null
  const { data, error } = await sb.from('commerce_products').update(m).eq('tenant_id', c.tenantId).eq('id', id).select(SELECT).single()
  if (error) return { ok: false, error: error.code === '23505' ? 'That SKU is already in use. Choose a different one.' : error.message }
  await addCommerceEvent(c.tenantId, 'product', id, 'updated', null, c.actor)
  return { ok: true, product: row(data as Record<string, unknown>) }
}

// Archive (soft): preserved for historical orders, removed from the active catalog (§18, test #20).
export async function archiveProduct(id: string): Promise<boolean> {
  const c = await requireCommerceAccess(); if (!c) return false
  const sb = await createClient()
  const { error } = await sb.from('commerce_products').update({ status: 'archived', archived_at: new Date().toISOString() }).eq('tenant_id', c.tenantId).eq('id', id)
  if (!error) await addCommerceEvent(c.tenantId, 'product', id, 'archived', null, c.actor)
  return !error
}

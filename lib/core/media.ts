import { createAdminClient } from '@/lib/supabase/server'

// Product media gallery (product_media). URL-based entries, consistent with how catalog_products already
// references images. Tenant-scoped. "Primary image" is the product's image_url (set via the product PATCH),
// so there's no separate primary flag to keep in sync.
const admin = () => createAdminClient()

export type MediaKind = 'image' | 'video' | 'file'
export interface MediaRow { id: string; product_id: string; url: string; kind: string; alt: string | null; sort_order: number; created_at: string }

export async function listMedia(tenantId: string, productId: string): Promise<MediaRow[]> {
  const { data } = await admin().from('product_media').select('id, product_id, url, kind, alt, sort_order, created_at')
    .eq('tenant_id', tenantId).eq('product_id', productId).order('sort_order').order('created_at')
  return (data as MediaRow[]) ?? []
}

export async function addMedia(tenantId: string, productId: string, input: { url: string; kind?: MediaKind; alt?: string | null }): Promise<{ ok: true; media: MediaRow } | { ok: false; error: string }> {
  if (!input.url?.trim()) return { ok: false, error: 'url_required' }
  const { count } = await admin().from('product_media').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('product_id', productId)
  const { data, error } = await admin().from('product_media').insert({
    tenant_id: tenantId, product_id: productId, url: input.url.trim(), kind: input.kind ?? 'image', alt: input.alt ?? null, sort_order: count ?? 0,
  }).select('id, product_id, url, kind, alt, sort_order, created_at').single()
  return error ? { ok: false, error: error.message } : { ok: true, media: data as MediaRow }
}

export async function deleteMedia(tenantId: string, id: string): Promise<boolean> {
  const { error } = await admin().from('product_media').delete().eq('tenant_id', tenantId).eq('id', id)
  return !error
}

// Persist a new media order (tenant-scoped per row).
export async function reorderMedia(tenantId: string, ids: string[]): Promise<boolean> {
  for (let i = 0; i < ids.length; i++) await admin().from('product_media').update({ sort_order: i }).eq('tenant_id', tenantId).eq('id', ids[i])
  return true
}

// Component media gallery — same table, keyed by component_id.
export async function listComponentMedia(tenantId: string, componentId: string): Promise<MediaRow[]> {
  const { data } = await admin().from('product_media').select('id, product_id, url, kind, alt, sort_order, created_at')
    .eq('tenant_id', tenantId).eq('component_id', componentId).order('sort_order').order('created_at')
  return (data as MediaRow[]) ?? []
}
export async function addComponentMedia(tenantId: string, componentId: string, input: { url: string; kind?: MediaKind; alt?: string | null }): Promise<{ ok: true; media: MediaRow } | { ok: false; error: string }> {
  if (!input.url?.trim()) return { ok: false, error: 'url_required' }
  const { count } = await admin().from('product_media').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('component_id', componentId)
  const { data, error } = await admin().from('product_media').insert({
    tenant_id: tenantId, component_id: componentId, url: input.url.trim(), kind: input.kind ?? 'image', alt: input.alt ?? null, sort_order: count ?? 0,
  }).select('id, product_id, url, kind, alt, sort_order, created_at').single()
  return error ? { ok: false, error: error.message } : { ok: true, media: data as MediaRow }
}

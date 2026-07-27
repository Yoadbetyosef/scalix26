import { createAdminClient } from '@/lib/supabase/server'
import type { StudioProduct } from '@/lib/studio/types'

type AdminDb = ReturnType<typeof createAdminClient>

// Fields we mirror from a catalog product onto its studio counterpart. Studio-only fields
// (fabric, sub-products, supplier, status, specs) are never touched by the sync.
interface CatalogLike {
  id: string
  name?: string | null
  category?: string | null
  description?: string | null
  price?: number | null
  image_url?: string | null
}

const sharedFields = (cat: CatalogLike) => ({
  name: cat.name || 'Untitled',
  category: cat.category ?? null,
  description: cat.description ?? null,
  base_price: cat.price ?? null,
})

/**
 * Ensure a studio_products row exists for a catalog product, and return it. Idempotent and
 * race-safe (the UNIQUE(catalog_product_id) constraint collapses a double-create). Photos are
 * seeded once from the catalog image; after that Studio owns its own photo list.
 */
export async function ensureStudioForCatalog(db: AdminDb, tenantId: string, cat: CatalogLike): Promise<StudioProduct | null> {
  const existing = await db.from('studio_products').select('*').eq('catalog_product_id', cat.id).eq('tenant_id', tenantId).maybeSingle()
  if (existing.data) return existing.data as StudioProduct

  const insert = await db.from('studio_products').insert({
    tenant_id: tenantId, catalog_product_id: cat.id,
    ...sharedFields(cat), photos: cat.image_url ? [cat.image_url] : [],
  }).select('*').single()
  if (insert.data) return insert.data as StudioProduct

  // Lost a create race (unique violation) — read the row the other request created.
  const retry = await db.from('studio_products').select('*').eq('catalog_product_id', cat.id).eq('tenant_id', tenantId).maybeSingle()
  return (retry.data as StudioProduct) ?? null
}

/** Mirror shared display fields (name/category/description/price) onto the linked studio product. */
export async function syncStudioFromCatalog(db: AdminDb, tenantId: string, cat: CatalogLike): Promise<void> {
  const studio = await ensureStudioForCatalog(db, tenantId, cat)
  if (!studio) return
  await db.from('studio_products').update({ ...sharedFields(cat), updated_at: new Date().toISOString() })
    .eq('id', studio.id).eq('tenant_id', tenantId)
}

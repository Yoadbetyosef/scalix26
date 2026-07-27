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

export interface FabricFields {
  fabric_category: string | null
  fabric_family: string | null
  fabric_name: string | null
  fabric_composition: string | null
  fabric_durability: string | null
}

/**
 * Mirror shared display fields (name/category/description/price) onto the linked studio product,
 * and — when provided — the fabric selection chosen on the catalog form.
 */
export async function syncStudioFromCatalog(db: AdminDb, tenantId: string, cat: CatalogLike, fabric?: FabricFields): Promise<void> {
  const studio = await ensureStudioForCatalog(db, tenantId, cat)
  if (!studio) return
  const patch: Record<string, unknown> = { ...sharedFields(cat), updated_at: new Date().toISOString() }
  if (fabric) {
    patch.fabric_category = fabric.fabric_category ?? null
    patch.fabric_family = fabric.fabric_family ?? null
    patch.fabric_name = fabric.fabric_name ?? null
    patch.fabric_composition = fabric.fabric_composition ?? null
    patch.fabric_durability = fabric.fabric_durability ?? null
  }
  await db.from('studio_products').update(patch).eq('id', studio.id).eq('tenant_id', tenantId)
}

/** Read the linked studio product's fabric selection (for pre-filling the catalog edit form). */
export async function getStudioFabric(db: AdminDb, tenantId: string, cat: CatalogLike): Promise<FabricFields | null> {
  const studio = await ensureStudioForCatalog(db, tenantId, cat)
  if (!studio) return null
  return {
    fabric_category: studio.fabric_category, fabric_family: studio.fabric_family, fabric_name: studio.fabric_name,
    fabric_composition: studio.fabric_composition, fabric_durability: studio.fabric_durability,
  }
}

/** Pull fabric_* fields out of a request body as clean string|null values. */
export function fabricFromBody(body: Record<string, unknown>): FabricFields {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    fabric_category: str(body.fabric_category), fabric_family: str(body.fabric_family), fabric_name: str(body.fabric_name),
    fabric_composition: str(body.fabric_composition), fabric_durability: str(body.fabric_durability),
  }
}

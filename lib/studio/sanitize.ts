import { isStudioStatus, type StudioProductStatus } from './types'

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null }

/**
 * A money amount, or null for "no price". NEGATIVE IS NOT A PRICE — it used to pass straight through
 * num(), so a typo'd "-650" reached studio_products.base_price and then variantPrice(), and from
 * there a quote/invoice line. Rejected to null rather than clamped to 0, because a silent 0 reads as
 * "this piece is free" on the customer's page, which is worse than reading as "no price yet".
 */
const price = (v: unknown) => { const n = num(v); return n != null && n >= 0 ? n : null }

const strMap = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof k === 'string' && k.trim() && typeof val === 'string' && val.trim()) out[k.trim()] = val.trim()
  }
  return out
}

/** 1 cover + 7 more, for a PRODUCT. The cover is photos[0] — "set as primary" is a move to the
 *  front, not a flag, so there is no second source of truth about which photo is the cover. */
export const MAX_PHOTOS = 8

/** Sub-products keep the 12 they have always had. The 8 above is the main product/customer-scan
 *  requirement and is NOT a technical limit, so there is no reason to take four away from a
 *  sub-product that may already be using them. */
export const MAX_VARIANT_PHOTOS = 12

const photoList = (v: unknown, cap: number): string[] =>
  Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim()).slice(0, cap) : []

// Whitelist + coerce editable product fields. tenant_id is NEVER taken from the client.
export function sanitizeProduct(body: Record<string, unknown>) {
  return {
    name: str(body.name) || 'Untitled',
    category: str(body.category),
    description: str(body.description),
    // ONLY when the caller sent it. PATCH feeds this whole object to .update(), so an
    // unconditional `specs: strMap(undefined)` wrote {} and erased the spec table on every save
    // from ProductForm — which has no specs control and therefore never sends the key.
    ...('specs' in body ? { specs: strMap(body.specs) } : {}),
    base_price: price(body.base_price),
    photos: photoList(body.photos, MAX_PHOTOS),
    status: (isStudioStatus(body.status) ? body.status : 'active') as StudioProductStatus,
    supplier_name: str(body.supplier_name),
    supplier_email: str(body.supplier_email),
    internal_notes: str(body.internal_notes),
    fabric_category: str(body.fabric_category),
    fabric_family: str(body.fabric_family),
    fabric_name: str(body.fabric_name),
    fabric_composition: str(body.fabric_composition),
    fabric_durability: str(body.fabric_durability),
  }
}

// Whitelist + coerce editable sub-product (variant) fields (product_id/tenant_id set server-side).
export function sanitizeVariant(body: Record<string, unknown>) {
  const pos = Math.trunc(Number(body.position))
  const name = str(body.name)
  const fabricName = str(body.fabric_name)
  return {
    name,
    description: str(body.description),
    photos: photoList(body.photos, MAX_VARIANT_PHOTOS),
    // label is a NOT NULL display fallback — derive it from the richest available field.
    label: name || fabricName || str(body.label) || 'Sub-product',
    attributes: strMap(body.attributes),
    sku: str(body.sku),
    price: price(body.price),
    fabric_category: str(body.fabric_category),
    fabric_family: str(body.fabric_family),
    fabric_name: fabricName,
    fabric_composition: str(body.fabric_composition),
    fabric_durability: str(body.fabric_durability),
    position: Number.isFinite(pos) && pos >= 0 ? pos : 0,
  }
}

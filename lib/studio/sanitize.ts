import { isStudioStatus, type StudioProductStatus } from './types'

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null }

const strMap = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof k === 'string' && k.trim() && typeof val === 'string' && val.trim()) out[k.trim()] = val.trim()
  }
  return out
}

const photos = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim()).slice(0, 12) : []

// Whitelist + coerce editable product fields. tenant_id is NEVER taken from the client.
export function sanitizeProduct(body: Record<string, unknown>) {
  return {
    name: str(body.name) || 'Untitled',
    category: str(body.category),
    description: str(body.description),
    specs: strMap(body.specs),
    base_price: num(body.base_price),
    photos: photos(body.photos),
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
    photos: photos(body.photos),
    // label is a NOT NULL display fallback — derive it from the richest available field.
    label: name || fabricName || str(body.label) || 'Sub-product',
    attributes: strMap(body.attributes),
    sku: str(body.sku),
    price: num(body.price),
    fabric_category: str(body.fabric_category),
    fabric_family: str(body.fabric_family),
    fabric_name: fabricName,
    fabric_composition: str(body.fabric_composition),
    fabric_durability: str(body.fabric_durability),
    position: Number.isFinite(pos) && pos >= 0 ? pos : 0,
  }
}

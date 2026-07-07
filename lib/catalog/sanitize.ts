import { isAvailabilityStatus, PRODUCT_STATUSES, type ProductStatus } from './types'

// Whitelist + coerce editable product fields from a request body. tenant_id is NEVER taken
// from the client — always the server-resolved tenant.
export function sanitizeProduct(body: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const int = (v: unknown) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0 }
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null }
  return {
    name: str(body.name) || 'Untitled',
    sku: str(body.sku),
    category: str(body.category),
    brand: str(body.brand),
    description: str(body.description),
    price: num(body.price),
    status: (PRODUCT_STATUSES as readonly string[]).includes(String(body.status)) ? (body.status as ProductStatus) : 'active',
    availability_status: isAvailabilityStatus(body.availability_status) ? body.availability_status : 'in_stock',
    showroom_quantity: int(body.showroom_quantity),
    warehouse_quantity: int(body.warehouse_quantity),
    storage_quantity: int(body.storage_quantity),
    incoming_quantity: int(body.incoming_quantity),
    expected_arrival_date: str(body.expected_arrival_date),
    location_notes: str(body.location_notes),
    tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string').slice(0, 30) : [],
    internal_notes: str(body.internal_notes),
    ai_notes: str(body.ai_notes),
    image_url: str(body.image_url),
  }
}

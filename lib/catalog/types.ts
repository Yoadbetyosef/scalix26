// Business Catalog v1 — shared types + constants (isomorphic, no server imports).

export const PRODUCT_STATUSES = ['active', 'inactive', 'discontinued'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

export const AVAILABILITY_STATUSES = ['in_stock', 'out_of_stock', 'incoming', 'special_order'] as const
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number]

export const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  in_stock: 'In stock',
  out_of_stock: 'Out of stock',
  incoming: 'Incoming',
  special_order: 'Special order',
}

export const MOVEMENT_TYPES = ['receive', 'move', 'sell', 'adjust', 'return'] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export const LOCATIONS = ['showroom', 'warehouse', 'storage'] as const
export type Location = (typeof LOCATIONS)[number]

export interface CatalogProduct {
  id: string
  tenant_id: string
  name: string
  sku: string | null
  category: string | null
  brand: string | null
  description: string | null
  price: number | null
  status: ProductStatus
  availability_status: AvailabilityStatus
  showroom_quantity: number
  warehouse_quantity: number
  storage_quantity: number
  incoming_quantity: number
  expected_arrival_date: string | null
  location_notes: string | null
  tags: string[]
  internal_notes: string | null
  ai_notes: string | null
  image_url: string | null
  qr_code_token: string
  created_at: string
  updated_at: string
}

// A part/piece of a product (e.g. a panel of a sofa). Its qr_code_token opens a public /q/<token> page.
export interface CatalogPart {
  id: string
  tenant_id: string
  product_id: string
  name: string
  image_url: string | null
  price: number | null
  availability_status: AvailabilityStatus
  quantity: number
  sort_order: number
  notes: string | null
  qr_code_token: string
  created_at: string
  updated_at: string
}

export interface CatalogMovement {
  id: string
  tenant_id: string
  product_id: string
  movement_type: MovementType
  quantity: number
  from_location: string | null
  to_location: string | null
  note: string | null
  created_by: string | null
  created_at: string
}

/** On-hand total across physical locations (excludes incoming). */
export const totalAvailable = (p: Pick<CatalogProduct, 'showroom_quantity' | 'warehouse_quantity' | 'storage_quantity'>): number =>
  (p.showroom_quantity || 0) + (p.warehouse_quantity || 0) + (p.storage_quantity || 0)

export const isAvailabilityStatus = (v: unknown): v is AvailabilityStatus =>
  typeof v === 'string' && (AVAILABILITY_STATUSES as readonly string[]).includes(v)

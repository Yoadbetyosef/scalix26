export type ProductType = 'simple_product' | 'configurable_product' | 'component' | 'bundle' | 'service' | 'custom_item'
export type ProductStatus = 'draft' | 'active' | 'discontinued' | 'archived'
export type ItemKind = 'product' | 'variant'
export type LocationType = 'warehouse' | 'showroom' | 'floor_display' | 'reserved' | 'damaged' | 'in_transit'

export type MovementType =
  | 'opening_balance' | 'purchase_receipt' | 'sale_commitment' | 'reservation' | 'reservation_release'
  | 'allocation' | 'delivery' | 'customer_return' | 'supplier_return' | 'damage' | 'transfer_out'
  | 'transfer_in' | 'manual_adjustment' | 'cancellation_release'

export interface CommerceProduct {
  id: string
  name: string
  internalName: string | null
  description: string | null
  productType: ProductType
  category: string | null
  collection: string | null
  brand: string | null
  status: ProductStatus
  coverImage: string | null
  sku: string | null
  cost: number | null
  defaultPrice: number | null
  leadTimeDays: number | null
  tags: string[]
  archivedAt: string | null
  createdAt: string
}

export interface ProductInput {
  name: string
  internalName?: string | null
  description?: string | null
  productType?: ProductType
  category?: string | null
  collection?: string | null
  brand?: string | null
  status?: ProductStatus
  coverImage?: string | null
  sku?: string | null
  cost?: number | null
  defaultPrice?: number | null
  leadTimeDays?: number | null
  tags?: string[]
}

export interface CommerceLocation { id: string; name: string; type: LocationType; isDefault: boolean; isActive: boolean }

export interface InventoryLevel {
  id: string
  itemKind: ItemKind
  itemId: string
  locationId: string
  onHand: number
  reserved: number
  available: number
  incoming: number
  damaged: number
  allocated: number
  floorDisplay: number
  expectedArrivalDate: string | null
}

// Aggregated availability across a product/variant's locations.
export interface Availability { onHand: number; reserved: number; available: number; incoming: number; expectedArrivalDate: string | null }

// Bundle availability: how many complete bundles can be made, plus which component limits it (§3).
export interface BundleAvailability {
  buildable: number
  components: Array<{ itemKind: ItemKind; itemId: string; perBundle: number; available: number; limiting: boolean }>
}

// Design Studio catalog v1 — shared types + constants (isomorphic, no server imports).

export const STUDIO_PRODUCT_STATUSES = ['active', 'draft', 'archived'] as const
export type StudioProductStatus = (typeof STUDIO_PRODUCT_STATUSES)[number]

export const STUDIO_STATUS_LABELS: Record<StudioProductStatus, string> = {
  active: 'Active',
  draft: 'Draft',
  archived: 'Archived',
}

export interface StudioVariant {
  id: string
  tenant_id: string
  product_id: string
  label: string
  name: string | null
  description: string | null
  photos: string[]
  attributes: Record<string, string>
  sku: string | null
  price: number | null
  // Fabric selection (from the fabric library — see lib/studio/fabrics.ts)
  fabric_category: string | null
  fabric_family: string | null
  fabric_name: string | null
  fabric_composition: string | null
  fabric_durability: string | null
  position: number
  qr_token: string
  created_at: string
  updated_at: string
}

/** Best display name for a sub-product: its own name, else its fabric, else its label. */
export const variantTitle = (v: Pick<StudioVariant, 'name' | 'fabric_name' | 'label'>): string =>
  v.name || v.fabric_name || v.label || 'Sub-product'

export interface StudioProduct {
  id: string
  tenant_id: string
  name: string
  category: string | null
  description: string | null
  specs: Record<string, string>
  base_price: number | null
  photos: string[]
  status: StudioProductStatus
  supplier_name: string | null
  supplier_email: string | null
  internal_notes: string | null
  // Default fabric for the product (sub-products can override with their own)
  fabric_category: string | null
  fabric_family: string | null
  fabric_name: string | null
  fabric_composition: string | null
  fabric_durability: string | null
  catalog_product_id: string | null   // linked inventory product, if this came from the Catalog
  qr_token: string
  created_at: string
  updated_at: string
}

export type StudioProductWithVariants = StudioProduct & { variants: StudioVariant[] }

export const isStudioStatus = (v: unknown): v is StudioProductStatus =>
  typeof v === 'string' && (STUDIO_PRODUCT_STATUSES as readonly string[]).includes(v)

/** Effective price of a variant: its own override, else the product's base price. */
export const variantPrice = (p: Pick<StudioProduct, 'base_price'>, v: Pick<StudioVariant, 'price'>): number | null =>
  v.price ?? p.base_price ?? null

// ── Documents (the 3 product actions: production / quote / invoice) ──────────────────────
export const STUDIO_DOC_TYPES = ['production', 'quote', 'invoice'] as const
export type StudioDocType = (typeof STUDIO_DOC_TYPES)[number]

export const DOC_META: Record<StudioDocType, { title: string; party: string; noun: string }> = {
  production: { title: 'Production Order', party: 'Supplier', noun: 'production order' },
  quote: { title: 'Quote', party: 'Client', noun: 'quote' },
  invoice: { title: 'Invoice', party: 'Client', noun: 'invoice' },
}

export interface StudioDocLineItem {
  ref: string            // 'product' or a variant id — provenance of the line
  name: string
  fabric: string | null
  sku: string | null
  qty: number
  unit_price: number | null
  image?: string | null  // snapshot cover photo, for a richer document
  desc?: string | null   // snapshot short description
}

export interface StudioDocSettings {
  tenant_id: string
  logo_url: string | null
  accent_color: string | null
  terms: string | null
  validity_days: number
  updated_at: string
}

export interface StudioDocument {
  id: string
  tenant_id: string
  product_id: string | null
  type: StudioDocType
  token: string
  status: string
  party_name: string | null
  party_email: string | null
  notes: string | null
  currency: string
  line_items: StudioDocLineItem[]
  subtotal: number
  logo_url: string | null
  accent_color: string | null
  terms: string | null
  valid_until: string | null
  client_phone: string | null
  sent_at: string | null
  sent_channel: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export const isStudioDocType = (v: unknown): v is StudioDocType =>
  typeof v === 'string' && (STUDIO_DOC_TYPES as readonly string[]).includes(v)

/** A '#RRGGBB' brand colour, or null for the default neutral document look. Never trust the client. */
export const hexColor = (v: unknown): string | null =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null

/** Short human-facing document number derived from its token. */
export const docNumber = (d: Pick<StudioDocument, 'type' | 'token'>): string =>
  `${d.type.slice(0, 3).toUpperCase()}-${d.token.replace(/-/g, '').slice(0, 6).toUpperCase()}`

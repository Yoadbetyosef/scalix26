import type { OrderStage } from './stages'

// Jewelry attributes chosen from the tenant-managed dropdowns (lib/orders/options.ts). Stored as the
// option's label text — a line item is a snapshot, so retiring an option never alters a past order.
export interface JewelrySpec {
  stoneQuality: string | null; stoneColor: string | null; stoneOrigin: string | null; stoneType: string | null
  centerStoneShape: string | null; sideStoneShape: string | null
  centerStoneCarat: number | null; sideStoneCaratTotal: number | null; metalKarat: string | null
}

export interface OrderLineItem extends JewelrySpec {
  id: string; orderId: string; productName: string; description: string | null; sku: string | null
  quantity: number; unitPriceCents: number; measurements: string | null; color: string | null; material: string | null
  customSpec: string | null; productRef: string | null; lineTotalCents: number; displayOrder: number
}
export interface OrderEvent { id: string; orderId: string; type: string; actor: string | null; payload: Record<string, unknown> | null; createdAt: string }

export interface Order {
  id: string; tenantId: string; orderNumber: string; contactId: string | null
  customerName: string | null; customerEmail: string | null; customerPhone: string | null
  stage: OrderStage; factoryName: string | null; factoryContactName: string | null; factoryEmail: string | null
  assignedEmployee: string | null; orderDate: string | null; requestedCompletionDate: string | null; estimatedCompletionDate: string | null
  subtotalCents: number; depositCents: number; balanceCents: number; currency: string
  clientRequirements: string | null; isCustomDesign: boolean
  internalNotes: string | null; publicNotes: string | null; createdBy: string | null; createdAt: string; updatedAt: string
}
export interface OrderWithDetails extends Order { lineItems: OrderLineItem[]; events: OrderEvent[] }

export interface LineItemInput extends Partial<JewelrySpec> {
  productName: string; description?: string | null; sku?: string | null; quantity?: number; unitPriceCents?: number
  measurements?: string | null; color?: string | null; material?: string | null; customSpec?: string | null; productRef?: string | null
}
export interface OrderInput {
  orderNumber?: string | null
  contactId?: string | null; customerName?: string | null; customerEmail?: string | null; customerPhone?: string | null
  factoryName?: string | null; factoryContactName?: string | null; factoryEmail?: string | null; assignedEmployee?: string | null
  orderDate?: string | null; requestedCompletionDate?: string | null; estimatedCompletionDate?: string | null
  depositCents?: number; currency?: string; internalNotes?: string | null; publicNotes?: string | null
  clientRequirements?: string | null; isCustomDesign?: boolean
  lineItems?: LineItemInput[]
}

// Public-safe projection for the external approval page — NO internal notes/ids/tenant data.
// Jewelry specs ARE included: the factory and the customer both need them to approve the piece.
export interface PublicOrderView {
  orderNumber: string; customerName: string | null; requestedCompletionDate: string | null; publicNotes: string | null
  lineItems: Array<{ productName: string; description: string | null; quantity: number; measurements: string | null; color: string | null; material: string | null; customSpec: string | null } & JewelrySpec>
}

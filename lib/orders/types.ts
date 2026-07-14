import type { OrderStage } from './stages'

export interface OrderLineItem {
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
  internalNotes: string | null; publicNotes: string | null; createdBy: string | null; createdAt: string; updatedAt: string
}
export interface OrderWithDetails extends Order { lineItems: OrderLineItem[]; events: OrderEvent[] }

export interface LineItemInput {
  productName: string; description?: string | null; sku?: string | null; quantity?: number; unitPriceCents?: number
  measurements?: string | null; color?: string | null; material?: string | null; customSpec?: string | null; productRef?: string | null
}
export interface OrderInput {
  orderNumber?: string | null
  contactId?: string | null; customerName?: string | null; customerEmail?: string | null; customerPhone?: string | null
  factoryName?: string | null; factoryContactName?: string | null; factoryEmail?: string | null; assignedEmployee?: string | null
  orderDate?: string | null; requestedCompletionDate?: string | null; estimatedCompletionDate?: string | null
  depositCents?: number; currency?: string; internalNotes?: string | null; publicNotes?: string | null
  lineItems?: LineItemInput[]
}

// Public-safe projection for the external approval page — NO internal notes/ids/tenant data.
export interface PublicOrderView {
  orderNumber: string; customerName: string | null; requestedCompletionDate: string | null; publicNotes: string | null
  lineItems: Array<{ productName: string; description: string | null; quantity: number; measurements: string | null; color: string | null; material: string | null; customSpec: string | null }>
}

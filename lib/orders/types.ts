import type { OrderStage } from './stages'

// Jewelry attributes chosen from the tenant-managed dropdowns (lib/orders/options.ts). Stored as the
// option's label text — a line item is a snapshot, so retiring an option never alters a past order.
export interface JewelrySpec {
  stoneQuality: string | null; stoneColor: string | null; stoneOrigin: string | null; stoneType: string | null
  centerStoneShape: string | null; sideStoneShape: string | null
  centerStoneCarat: number | null; sideStoneCaratTotal: number | null; metalKarat: string | null
  certificateLab: string | null; ringSize: string | null
}

export interface OrderLineItem extends JewelrySpec {
  id: string; orderId: string; productName: string; description: string | null; sku: string | null
  quantity: number; unitPriceCents: number; measurements: string | null; color: string | null; material: string | null
  customSpec: string | null; productRef: string | null; lineTotalCents: number; displayOrder: number
  /**
   * INTERNAL ONLY — what this line cost to produce. Never rendered on a customer-facing surface.
   *
   * NULL means not recorded. 0 means genuinely free. Keeping them distinct is why the column is
   * nullable with no default: a default of 0 would make every order that predates it look like pure
   * margin, and an unknown margin is not a 100% one.
   */
  internalCostCents: number | null
}
export interface OrderEvent { id: string; orderId: string; type: string; actor: string | null; payload: Record<string, unknown> | null; createdAt: string }

export interface Order {
  // ── Added by add_orders_6, and OPTIONAL on the type on purpose ──────────────────────────────────
  // The application must render before the migration is run. Optional here means every consumer is
  // forced by the compiler to handle their absence, rather than reading undefined as a value.
  deliveryProvince?: string | null
  documentTemplateId?: string | null
  invoicedAt?: string | null
  archivedAt?: string | null

  id: string; tenantId: string; orderNumber: string; contactId: string | null
  customerName: string | null; customerEmail: string | null; customerPhone: string | null
  stage: OrderStage; factoryName: string | null; factoryContactName: string | null; factoryEmail: string | null
  assignedEmployee: string | null; orderDate: string | null; requestedCompletionDate: string | null; estimatedCompletionDate: string | null
  subtotalCents: number; depositCents: number; balanceCents: number; currency: string
  clientRequirements: string | null; isCustomDesign: boolean
  internalNotes: string | null; publicNotes: string | null; createdBy: string | null; createdAt: string; updatedAt: string
}
export interface OrderWithDetails extends Order { lineItems: OrderLineItem[]; events: OrderEvent[] }

/**
 * The order's total internal cost — DERIVED, never stored.
 *
 * A stored total would be a second copy of a number the lines already hold, and it goes wrong the
 * first time a line is edited without the rollup being recomputed. Unlike balance_cents, which IS
 * stored, this has no counterparty and no reason to be frozen: balance is a commercial snapshot the
 * customer agreed to; cost is an internal figure that should always equal its parts.
 *
 * Returns null when NO line has a cost recorded — because the total is then unknown, not zero. A
 * partial entry sums what exists, which is the honest reading of "some of it is known".
 */
export function orderInternalCostCents(lineItems: Pick<OrderLineItem, 'internalCostCents'>[]): number | null {
  const known = lineItems.map((l) => l.internalCostCents).filter((c): c is number => c !== null && c !== undefined)
  return known.length ? known.reduce((a, b) => a + b, 0) : null
}

export interface LineItemInput extends Partial<JewelrySpec> {
  productName: string; description?: string | null; sku?: string | null; quantity?: number; unitPriceCents?: number
  measurements?: string | null; color?: string | null; material?: string | null; customSpec?: string | null; productRef?: string | null
  /** INTERNAL ONLY. Omitted or null = not recorded. */
  internalCostCents?: number | null
}
export interface OrderInput {
  deliveryProvince?: string | null
  documentTemplateId?: string | null
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

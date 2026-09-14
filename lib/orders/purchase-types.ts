// The isomorphic half of lib/orders/purchases.ts: kinds, statuses, labels and the row type. No
// server imports, so the purchases panel (a client component) can read them.

export const PURCHASE_KINDS = ['stone', 'mounting', 'finding', 'casting', 'service', 'other'] as const
export type PurchaseKind = (typeof PURCHASE_KINDS)[number]
export const PURCHASE_KIND_LABELS: Record<PurchaseKind, string> = { stone: 'Stone', mounting: 'Mounting', finding: 'Finding', casting: 'Casting', service: 'Service', other: 'Other' }

export const PURCHASE_STATUSES = ['draft', 'waiting', 'in_production', 'shipped', 'received', 'qc_done'] as const
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number]
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  draft: 'Draft', waiting: 'Waiting for stone / mounting', in_production: 'In production', shipped: 'Ready / shipped', received: 'Received', qc_done: 'QC passed',
}

export interface OrderPurchase {
  id: string; orderId: string | null; supplierId: string | null; supplierName: string | null
  kind: PurchaseKind; description: string; quantity: number; costCents: number | null; currency: string
  reference: string | null; status: PurchaseStatus
  orderedOn: string | null; expectedOn: string | null; receivedOn: string | null; qcNote: string | null
  invoiceAttachmentId: string | null; notes: string | null; createdAt: string; updatedAt: string
}
export interface PurchaseInput {
  supplierId?: string | null; supplierName?: string | null
  kind?: PurchaseKind; description: string; quantity?: number; costCents?: number | null; currency?: string
  reference?: string | null; status?: PurchaseStatus
  orderedOn?: string | null; expectedOn?: string | null; receivedOn?: string | null; qcNote?: string | null
  invoiceAttachmentId?: string | null; notes?: string | null
}


import { isOrderKind } from './kinds'
import type { OrderStage } from './stages'
import type { Order, OrderLineItem, LineItemInput } from './types'

// ── THE ROW SHAPES, PURE ────────────────────────────────────────────────────────────────────────
//
// How an `orders` / `order_line_items` row becomes the typed object, and how a LineItemInput
// becomes the row that is written. Split out of store.ts so they can be TESTED without a Supabase
// client: lib/orders/persistence.test.ts round-trips every field through lineInsert → lineRow and
// fails the moment a column is written under one name and read under another — which is exactly
// how a field "stops saving" without any error.

export const orderRow = (r: Record<string, unknown>): Order => ({
  id: r.id as string, tenantId: r.tenant_id as string, orderNumber: r.order_number as string, contactId: (r.contact_id as string) ?? null,
  customerName: (r.customer_name as string) ?? null, customerEmail: (r.customer_email as string) ?? null, customerPhone: (r.customer_phone as string) ?? null,
  // Read off the row rather than selected by name, so a database without add_tg_jewellers_2 yields
  // undefined here instead of failing the whole query.
  customerCompany: (r.customer_company as string) ?? null,
  stage: r.stage as OrderStage, supplierId: (r.supplier_id as string) ?? null, factoryName: (r.factory_name as string) ?? null, factoryContactName: (r.factory_contact_name as string) ?? null, factoryEmail: (r.factory_email as string) ?? null,
  assignedEmployee: (r.assigned_employee as string) ?? null, orderDate: (r.order_date as string) ?? null, requestedCompletionDate: (r.requested_completion_date as string) ?? null, estimatedCompletionDate: (r.estimated_completion_date as string) ?? null,
  subtotalCents: Number(r.subtotal_cents ?? 0), depositCents: Number(r.deposit_cents ?? 0), balanceCents: Number(r.balance_cents ?? 0), currency: (r.currency as string) ?? 'usd',
  clientRequirements: (r.client_requirements as string) ?? null, isCustomDesign: r.is_custom_design === true,
  internalNotes: (r.internal_notes as string) ?? null, publicNotes: (r.public_notes as string) ?? null, createdBy: (r.created_by as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  // Added by add_orders_6. Read off the row rather than selected by name, so a database without the
  // migration yields undefined here instead of failing the whole query.
  deliveryProvince: (r.delivery_province as string) ?? null,
  // Read off the row rather than selected by name, so a database without add_order_tax_choice renders
  // through the live fallback instead of erroring — the same defence documentTemplateId already uses.
  taxKind: (r.tax_kind as 'gst_only' | 'combined') ?? null,
  taxLabel: (r.tax_label as string) ?? null,
  taxRatePercent: r.tax_rate_percent === null || r.tax_rate_percent === undefined ? null : Number(r.tax_rate_percent),
  pstExempt: r.pst_exempt === true,
  pstExemptionNote: (r.pst_exemption_note as string) ?? null,
  invoiceImageId: (r.invoice_image_id as string) ?? null,
  documentTemplateId: (r.document_template_id as string) ?? null,
  letterheadStyle: (r.letterhead_style as string) ?? null,
  invoicedAt: (r.invoiced_at as string) ?? null,
  archivedAt: (r.archived_at as string) ?? null,
  // add_tg_production_1 part 6. Absent column → 'custom', which is what every row was.
  orderKind: isOrderKind(r.order_kind) ? r.order_kind : 'custom',
  kindDetails: (r.kind_details && typeof r.kind_details === 'object' ? r.kind_details : {}) as Order['kindDetails'],
})
export const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
export const lineRow = (r: Record<string, unknown>): OrderLineItem => ({
  id: r.id as string, orderId: r.order_id as string, productName: r.product_name as string, description: (r.description as string) ?? null, sku: (r.sku as string) ?? null,
  quantity: Number(r.quantity ?? 1), unitPriceCents: Number(r.unit_price_cents ?? 0), measurements: (r.measurements as string) ?? null, color: (r.color as string) ?? null, material: (r.material as string) ?? null,
  customSpec: (r.custom_spec as string) ?? null, productRef: (r.product_ref as string) ?? null, lineTotalCents: Number(r.line_total_cents ?? 0), displayOrder: Number(r.display_order ?? 0),
  productType: (r.product_type as string) ?? null,
  stoneQuality: (r.stone_quality as string) ?? null, stoneColor: (r.stone_color as string) ?? null, stoneOrigin: (r.stone_origin as string) ?? null, stoneType: (r.stone_type as string) ?? null,
  centerStoneShape: (r.center_stone_shape as string) ?? null, sideStoneShape: (r.side_stone_shape as string) ?? null,
  // Read OFF THE ROW rather than selected by name, so a database without add_tg_jewellers_2 renders
  // the line exactly as it did before instead of erroring. The legacy single value is the fallback
  // for every row written before the array existed — a piece with one side shape reads identically
  // through either field, which is what lets the two coexist.
  sideStoneShapes: Array.isArray(r.side_stone_shapes)
    ? (r.side_stone_shapes as string[]).filter((v) => typeof v === 'string' && v.trim() !== '')
    : ((r.side_stone_shape as string) ? [r.side_stone_shape as string] : []),
  bandWidthMm: num(r.band_width_mm),
  centerStoneCarat: num(r.center_stone_carat), sideStoneCaratTotal: num(r.side_stone_carat_total), metalKarat: (r.metal_karat as string) ?? null,
  certificateLab: (r.certificate_lab as string) ?? null, ringSize: (r.ring_size as string) ?? null,
  // num() rather than Number(): it preserves NULL, which here means "not recorded" and must not
  // collapse to 0. See lib/orders/types.ts.
  internalCostCents: num(r.internal_cost_cents),
})

// One place that turns a LineItemInput into its DB row — used by both create and update so the jewelry
// columns can never drift between the two paths.
/**
 * The columns add_tg_jewellers_2.sql introduces, kept apart from the rest of the row.
 *
 * Separating them is what makes the retry in `insertLines` able to drop EXACTLY the new fields and
 * keep everything else — a blanket try/catch would have to guess which key offended.
 *
 * `side_stone_shape` (singular) is written from the FIRST entry of the array and is not in here: the
 * column already exists, and keeping it populated means the approval page, the AI's lookups and any
 * report still reading it keep working unchanged rather than silently going blank.
 */
export const lineExtras = (i: LineItemInput) => ({
  side_stone_shapes: i.sideStoneShapes ?? [],
  band_width_mm: i.bandWidthMm ?? null,
})

export const lineInsert = (tenantId: string, orderId: string, i: LineItemInput, total: number, idx: number) => ({
  tenant_id: tenantId, order_id: orderId, product_name: i.productName, description: i.description ?? null, sku: i.sku ?? null,
  quantity: i.quantity ?? 1, unit_price_cents: i.unitPriceCents ?? 0, measurements: i.measurements ?? null, color: i.color ?? null, material: i.material ?? null,
  custom_spec: i.customSpec ?? null, product_ref: i.productRef ?? null, line_total_cents: total, display_order: idx,
  product_type: i.productType ?? null, stone_quality: i.stoneQuality ?? null, stone_color: i.stoneColor ?? null, stone_origin: i.stoneOrigin ?? null, stone_type: i.stoneType ?? null,
  center_stone_shape: i.centerStoneShape ?? null,
  // The multi-select's first entry wins over the legacy single field when both arrive, because the
  // form now sends the array and the single value is derived from it. Falling back the other way
  // keeps an older client (or a direct API caller) working.
  side_stone_shape: i.sideStoneShapes?.[0] ?? i.sideStoneShape ?? null,
  center_stone_carat: i.centerStoneCarat ?? null, side_stone_carat_total: i.sideStoneCaratTotal ?? null, metal_karat: i.metalKarat ?? null,
  certificate_lab: i.certificateLab ?? null, ring_size: i.ringSize ?? null,
  internal_cost_cents: i.internalCostCents ?? null,
})

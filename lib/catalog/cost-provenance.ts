import { createAdminClient } from '@/lib/supabase/server'
import { landedCost } from './cost-math'

// Where a product's cost came from, and what it replaced.
//
// The question this answers is the one an owner actually asks, and the only one the cost card could
// not: "why did this change?" A figure that arrived from a supplier invoice looks identical to one
// typed by hand, and after a reorder overwrites it, the previous number is gone from the screen even
// though it is still in the database.
//
// ── NOTHING NEW IS STORED ───────────────────────────────────────────────────────────────────────────
//
// Both halves already exist and were simply unread:
//
//   supplier_invoice_lines.allocated_freight / _duties  — permanent, per shipment. Shipment 1 keeps
//     what it allocated to a product forever, whatever shipment 2 later does to the cost row.
//
//   landed_cost_shipments.applied_before  — a snapshot of product_costs as they stood before that
//     shipment first landed. So shipment 2's applied_before IS shipment 1's contribution.
//
// This file lives in lib/catalog rather than lib/invoices on purpose: lib/invoices/store.ts already
// imports getCostSettings from lib/catalog/costs, so a provenance lookup living over there and being
// imported back would close a cycle. It reads the invoice tables directly and imports nothing from
// that module.

export interface PreviousCost {
  costPrimary: number | null
  costSecondary: number | null
  shippingCost: number
  tariffCost: number
  markupPercent: number
  /** Recomputed with the same function the generated column mirrors — never stored, never read back. */
  computedCost: number | null
}

export interface CostProvenance {
  shipmentId: string
  reference: string | null
  supplierName: string | null
  invoiceNumber: string | null
  appliedAt: string
  /**
   * What this product's cost was immediately before that shipment landed.
   *
   * Null when nothing preceded it — the ordinary case for a product created BY the invoice, whose
   * first cost is also its only one. Present after a reorder, and that is the whole point: "was 14.20"
   * beside "is 16.22" answers the question without anyone having to remember last month.
   */
  previous: PreviousCost | null
}

interface ShipmentRow {
  id: string
  reference: string | null
  applied_at: string
  applied_before: Array<Record<string, unknown>> | null
}

/**
 * The applied shipment that most recently set this product's cost, if any.
 *
 * Latest wins is the model (see catalog-worker/OUTSTANDING.md), so the most recently applied shipment
 * is by definition the one whose numbers are in the cost row — there is no ambiguity to resolve, only
 * a lookup.
 *
 * Returns null for a hand-typed cost, for a tenant with no invoices, and for a shipment still in
 * review. All three are ordinary, and the card simply shows no attribution.
 */
export async function costProvenance(tenantId: string, productId: string): Promise<CostProvenance | null> {
  const db = createAdminClient()

  // Sorted in JS rather than by PostgREST: ordering on an embedded resource is awkward to express, the
  // row count here is the number of shipments that carried ONE product — one or two in practice — and
  // a wrong sort would attribute the cost to the wrong invoice, which is worse than a wasted row.
  const { data } = await db.from('supplier_invoice_lines')
    .select('supplier_invoices!inner(invoice_number, supplier_name, landed_cost_shipments!inner(id, reference, applied_at, applied_before, status))')
    .eq('tenant_id', tenantId)
    .eq('product_id', productId)
    .eq('status', 'matched')
    .eq('supplier_invoices.landed_cost_shipments.status', 'applied')
    .limit(20)

  type Row = { supplier_invoices: { invoice_number: string | null; supplier_name: string | null; landed_cost_shipments: ShipmentRow } }
  const rows = ((data as unknown as Row[] | null) ?? []).filter((r) => r.supplier_invoices?.landed_cost_shipments?.applied_at)
  if (!rows.length) return null

  const latest = rows.reduce((a, b) =>
    a.supplier_invoices.landed_cost_shipments.applied_at >= b.supplier_invoices.landed_cost_shipments.applied_at ? a : b)
  const ship = latest.supplier_invoices.landed_cost_shipments

  // applied_before holds one entry per product the shipment overwrote. A product created BY this
  // invoice has no entry, which is the correct absence rather than a missing lookup.
  const before = (ship.applied_before ?? []).find((e) => e.productId === productId)
  const n = (v: unknown): number => Number(v ?? 0)
  const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

  return {
    shipmentId: ship.id,
    reference: ship.reference,
    supplierName: latest.supplier_invoices.supplier_name,
    invoiceNumber: latest.supplier_invoices.invoice_number,
    appliedAt: ship.applied_at,
    previous: before
      ? {
          costPrimary: nn(before.costPrimary),
          costSecondary: nn(before.costSecondary),
          shippingCost: n(before.shippingCost),
          tariffCost: n(before.tariffCost),
          markupPercent: n(before.markupPercent),
          computedCost: landedCost(nn(before.costPrimary), n(before.shippingCost), n(before.tariffCost), n(before.markupPercent)),
        }
      : null,
  }
}

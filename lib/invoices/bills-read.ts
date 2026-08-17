import { createAdminClient } from '@/lib/supabase/server'
import { listShipments } from './store'
import { coverage } from './allocate'
import { MIN_COVERAGE } from './types'
import type { Coverage } from './allocate'

// WHAT /v2/bills READS — docs/miles/supplier-invoices.html.
//
// It goes through `listShipments()` rather than querying `landed_cost_shipments` itself, because that
// function is where the tenant gate lives and a second door onto the same table is a second thing that
// can forget it. What this file adds is the one thing the list needs and the store does not return:
// COVERAGE, which is a fact about the LINES, not about the shipment row.
//
// ── COVERAGE IS THE HEADLINE, NOT THE TOTAL ─────────────────────────────────────────────────────
//
// The reference puts a bar under every bill and the money to the side, and that ordering is the whole
// argument of the screen. €18,420 tells an owner nothing they can act on. "74% matched" tells them
// the bill cannot be applied yet and roughly how much work is left — and, more importantly, that if it
// WERE applied at 74%, the matched products would absorb freight belonging to goods nobody identified.
// See MIN_COVERAGE in ./types for why that is the number and not a preference.
//
// One query for every line on the page, not one per bill. Two bills is fine either way; an importer
// with forty is not, and this is a list screen.

export interface BillRow {
  id: string
  supplier: string
  /** The supplier's own number for it, or the filename when the extraction found none. */
  reference: string | null
  currency: string
  /** The invoice's grand total, or the sum of its lines when the document stated none. */
  totalValue: number
  lineCount: number
  coverage: Coverage
  status: 'waiting' | 'applied' | 'reading' | 'failed'
  /** Set only once it has been applied — the date the costs actually moved. */
  appliedAt: string | null
  createdAt: string
  /** How many distinct products the applied costs landed on. Null until applied. */
  productsCosted: number | null
  /** True when coverage alone would block Apply. The list says so before the owner opens it. */
  belowGate: boolean
}

export interface BillList {
  waiting: BillRow[]
  applied: BillRow[]
  /** Neither group: still being read, or the read failed. Small, and never silently dropped. */
  other: BillRow[]
  total: number
}

/** The status the SCREEN cares about, which is not the same set the pipeline tracks internally. */
function billStatus(s: string): BillRow['status'] {
  if (s === 'applied') return 'applied'
  if (s === 'failed') return 'failed'
  // 'draft' and 'extracting' are both "we are still reading it"; 'review' is the only one that is
  // genuinely waiting on a person, and it is the one the opening line counts.
  if (s === 'review') return 'waiting'
  return 'reading'
}

export async function readBills(tenantId: string): Promise<BillList | null> {
  const res = await listShipments()
  if (!res.ok) return null

  const invoiceIds = res.data.map((s) => s.invoice?.id).filter((x): x is string => !!x)
  const db = createAdminClient()
  const { data: lines } = invoiceIds.length
    ? await db.from('supplier_invoice_lines')
        .select('invoice_id, extended, status, product_id')
        .eq('tenant_id', tenantId).in('invoice_id', invoiceIds)
    : { data: [] }

  const byInvoice = new Map<string, Array<{ extended: number; status: string; product_id: string | null }>>()
  for (const l of (lines ?? []) as Array<{ invoice_id: string; extended: number; status: string; product_id: string | null }>) {
    const arr = byInvoice.get(l.invoice_id) ?? []
    arr.push({ extended: Number(l.extended ?? 0), status: l.status, product_id: l.product_id })
    byInvoice.set(l.invoice_id, arr)
  }

  const rows: BillRow[] = res.data.map((s) => {
    const inv = s.invoice
    const own = inv ? byInvoice.get(inv.id) ?? [] : []
    const cov = coverage(own as Array<{ extended: number; status: 'matched' | 'unmatched' | 'skipped' }>)
    const status = billStatus(s.status)
    return {
      id: s.id,
      // The supplier's name if the extraction found one. Falling back to the shipment reference and
      // then to the filename means a row always says WHOSE bill it is, which is the first thing
      // anybody scans for.
      supplier: inv?.supplierName?.trim() || s.reference?.trim() || inv?.fileName || 'Supplier bill',
      reference: inv?.invoiceNumber?.trim() || null,
      currency: (inv?.currency || s.currency || 'usd').toUpperCase(),
      // The document's own total when it stated one; otherwise the lines, which is what the allocation
      // uses anyway. Never zero when there are lines to add up.
      totalValue: inv?.grandTotal ?? cov.totalValue,
      lineCount: own.length,
      coverage: cov,
      status,
      appliedAt: s.appliedAt,
      createdAt: s.createdAt,
      productsCosted: status === 'applied'
        ? new Set(own.filter((l) => l.product_id).map((l) => l.product_id)).size
        : null,
      belowGate: cov.ratio < MIN_COVERAGE,
    }
  })

  return {
    waiting: rows.filter((r) => r.status === 'waiting'),
    applied: rows.filter((r) => r.status === 'applied'),
    other: rows.filter((r) => r.status === 'reading' || r.status === 'failed'),
    total: rows.length,
  }
}

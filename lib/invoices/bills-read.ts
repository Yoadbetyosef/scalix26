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
// One query per PAGE OF LINES, not one per bill. Two bills is fine either way; an importer with forty
// is not, and this is a list screen.
//
// ── WHY IT PAGES ────────────────────────────────────────────────────────────────────────────────
//
// PostgREST returns at most 1,000 rows per request regardless of any limit, so a plain select against
// every line on the screen SILENTLY returns a truncated set. `listShipments()` fetches up to 100
// shipments; two real invoices are 133 and 80 lines, so the cap sits about eight bills away.
//
// What truncation looks like is the reason this is worth the loop: a bill whose lines fell off the end
// of the page gets an empty line array, which is a coverage of 0 — so it renders as "0 lines · 0%
// matched" and an amber bar, indistinguishable from a bill the matcher genuinely could not place. An
// hour was spent on that reading once already, from a different cause (a bill uploaded into a
// workspace with no catalogue). Once is enough. The same cap has produced one wrong answer elsewhere
// in this codebase — the orphan cleanup reported 1,000 rows when there were 9,179 — and lib/invoices/
// match.ts pages for exactly this reason.

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

/** The page size PostgREST enforces whatever we ask for. */
const PAGE = 1000

/**
 * Every line belonging to these invoices, paged.
 *
 * Ordered by `id` because a range without an order is a range over an unspecified sequence — the same
 * row could arrive on two pages or on none. `id` is arbitrary but stable, and nothing downstream cares
 * about line order: the caller groups by invoice and sums.
 *
 * The ceiling exists only so a server that kept answering full pages cannot spin here forever. It is
 * two orders of magnitude above the real shape (100 shipments, a large invoice being a few hundred
 * lines), so the normal exit is always the short page.
 */
const MAX_LINES = 200_000

interface LineRow { invoice_id: string; extended: number; status: string; product_id: string | null }

async function readLines(tenantId: string, invoiceIds: string[]): Promise<LineRow[]> {
  if (!invoiceIds.length) return []
  const db = createAdminClient()
  const out: LineRow[] = []

  for (let from = 0; from < MAX_LINES; from += PAGE) {
    const { data } = await db.from('supplier_invoice_lines')
      .select('invoice_id, extended, status, product_id')
      .eq('tenant_id', tenantId).in('invoice_id', invoiceIds)
      .order('id')
      .range(from, from + PAGE - 1)

    const page = ((data as LineRow[] | null) ?? [])
    out.push(...page)
    if (page.length < PAGE) break   // a short page means the end, and saves a request that returns nothing
  }

  return out
}

export async function readBills(tenantId: string): Promise<BillList | null> {
  const res = await listShipments()
  if (!res.ok) return null

  const invoiceIds = res.data.map((s) => s.invoice?.id).filter((x): x is string => !!x)
  const lines = await readLines(tenantId, invoiceIds)

  const byInvoice = new Map<string, Array<{ extended: number; status: string; product_id: string | null }>>()
  for (const l of lines) {
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

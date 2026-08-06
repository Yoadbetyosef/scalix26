import type { InvoiceLine } from './types'

// Spreading one shipment's freight and duties across the products it carried.
//
// PURE. No database, no session, no clock — the whole file is arithmetic, because this is the number
// that becomes a cost, becomes a margin, becomes a price, and it has to be checkable without a fixture.
//
// ── WHAT THE ALLOCATION IS, AND WHAT IT ISN'T ───────────────────────────────────────────────────────
//
// Charges are apportioned by line EXTENDED VALUE — quantity x unit price. Freight actually correlates
// with weight and volume, and a supplier invoice carries neither, so value is a PROXY. It is the one a
// bookkeeper would reach for and the one an accountant will recognise, but a pallet of cushions and a
// pallet of marble tops do not cost the same to ship at equal invoice value. The UI says this out loud
// rather than implying a precision that isn't there.
//
// ── THE DENOMINATOR: MATCHED LINES ONLY ─────────────────────────────────────────────────────────────
//
// Only matched lines take a share, and the FULL charge is distributed across them. The alternative —
// dividing by every line, matched or not — makes the shipping attributable to unmatched goods simply
// evaporate: what gets written sums to less than what was paid, every matched product is understated,
// and the error grows with how badly the matching went.
//
// Understating landed cost causes underpricing, which loses money silently on every unit sold, forever.
// Overstating it causes conservative pricing, which loses a sale someone can see and argue with. Given
// a choice between an invisible error and a visible one, take the visible one.
//
// That choice is only defensible because it is never made silently: coverage() below drives a figure on
// the approval screen, and nothing is written until the owner has seen it. At low coverage the correct
// response is to go match the missing lines, not to accept either denominator.

/** Money as integer cents. Every intermediate step happens here so a float never reaches a total. */
const cents = (n: number): number => Math.round(n * 100)
const fromCents = (c: number): number => c / 100

export interface Charges {
  freightTotal: number
  dutiesTotal: number
  /** Handling, insurance, brokerage. Allocated with freight and written to the same column — the split
   *  that matters downstream is duty vs not-duty, because duty is what customs paperwork asks for. */
  otherTotal: number
}

export interface Allocation {
  lineId: string
  allocatedFreight: number
  allocatedDuties: number
}

/**
 * Distribute one charge across weighted parts so the parts sum to EXACTLY the charge.
 *
 * Largest-remainder: give everyone their floor, then hand the leftover cents out one each, biggest
 * fractional remainder first. Ties break on weight and then on position, so the same invoice always
 * allocates the same way — an allocation that shifted a penny between runs would make the approval
 * screen disagree with what the apply wrote.
 *
 * Without this the pennies vanish: eight lines each rounded down loses up to seven cents, the shipment
 * no longer reconciles against the invoice, and apply_shipment_costs refuses the write.
 */
function distribute(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (totalCents === 0 || sum <= 0) return weights.map(() => 0)

  const exact = weights.map((w) => (totalCents * w) / sum)
  const floors = exact.map(Math.floor)
  let remaining = totalCents - floors.reduce((a, b) => a + b, 0)

  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e), weight: weights[i] }))
    .sort((a, b) => b.frac - a.frac || b.weight - a.weight || a.i - b.i)

  // `remaining` is bounded by the number of parts, so this terminates; the guard is for the degenerate
  // case where every weight is zero and `order` cannot absorb it.
  for (let k = 0; k < order.length && remaining > 0; k++, remaining--) floors[order[k].i]++
  return floors
}

/**
 * The allocation for a whole invoice. Every line comes back, including the ones taking nothing, so the
 * caller writes a complete set of rows rather than leaving a skipped line's previous share behind.
 */
export function allocate(charges: Charges, lines: Pick<InvoiceLine, 'id' | 'extended' | 'status'>[]): Allocation[] {
  const matched = lines.filter((l) => l.status === 'matched')
  const weights = matched.map((l) => Math.max(0, cents(l.extended)))

  // Freight and other charges travel together into one column; duties stay separate.
  const freight = distribute(cents(charges.freightTotal) + cents(charges.otherTotal), weights)
  const duties = distribute(cents(charges.dutiesTotal), weights)

  const byId = new Map<string, Allocation>()
  matched.forEach((l, i) => byId.set(l.id, {
    lineId: l.id,
    allocatedFreight: fromCents(freight[i]),
    allocatedDuties: fromCents(duties[i]),
  }))

  return lines.map((l) => byId.get(l.id) ?? { lineId: l.id, allocatedFreight: 0, allocatedDuties: 0 })
}

export interface Coverage {
  totalValue: number
  matchedValue: number
  /** Matched share of invoice value, 0–1. Zero when the invoice carries no value at all. */
  ratio: number
  matchedLines: number
  /** "We could not find it" — a recall problem, and the one the owner can fix by matching. */
  unmatchedLines: number
  /** "The owner said don't" — a deliberate exclusion, which is not a failure and must not read as one. */
  skippedLines: number
  unmatchedValue: number
}

/**
 * How much of this invoice the allocation actually rests on.
 *
 * This is the number that makes the matched-only denominator honest, so it is computed here and shown
 * on the approval screen rather than being an internal detail of the allocator.
 *
 * unmatched and skipped are counted apart on purpose: one says the matching failed and the other says
 * the owner made a decision. Collapsing them would let a deliberate exclusion read as a defect — the
 * same reason catalog_retrieval_log keeps `errored` apart from `resolved`.
 */
export function coverage(lines: Pick<InvoiceLine, 'extended' | 'status'>[]): Coverage {
  const sum = (f: (l: { extended: number; status: string }) => boolean) =>
    lines.filter(f).reduce((a, l) => a + l.extended, 0)

  const totalValue = sum(() => true)
  const matchedValue = sum((l) => l.status === 'matched')

  return {
    totalValue,
    matchedValue,
    ratio: totalValue > 0 ? matchedValue / totalValue : 0,
    matchedLines: lines.filter((l) => l.status === 'matched').length,
    unmatchedLines: lines.filter((l) => l.status === 'unmatched').length,
    skippedLines: lines.filter((l) => l.status === 'skipped').length,
    unmatchedValue: sum((l) => l.status === 'unmatched'),
  }
}

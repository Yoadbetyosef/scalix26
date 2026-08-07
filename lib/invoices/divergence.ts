// What applying this shipment would do to a product that already has a cost.
//
// ISOMORPHIC — no server imports — so the approval screen previews exactly what the apply gate
// enforces. One computation, two callers; a preview that disagreed with the gate would be worse than
// no preview at all.
//
// ── WHY MARGIN AND NOT COST ─────────────────────────────────────────────────────────────────────────
//
// A cost rising is not the harm. Costs rise constantly and harmlessly — a different freight quote, a
// weaker euro, a duty reclassification. THE HARM IS A PRICE THAT DIDN'T MOVE WITH IT. A landed cost
// that goes up 40% against a fixed sale price is a margin that quietly collapsed, and the product goes
// on being sold at the old number until somebody works out why the year was thin.
//
// So the flag's subject is the margin. Cost divergence is how it is DETECTED; margin collapse is what
// it is ABOUT. "Cost moved 40%" is a fact the owner has to do arithmetic on. "Margin falls from 42% to
// 19%" is the same fact already answered.
//
// ── WHY TWO GATES ───────────────────────────────────────────────────────────────────────────────────
//
// Relative alone is the wallpaper trap. A 30% move on a $2 fitting is noise; cheap SKUs are most of the
// lines on any real invoice, so a relative-only threshold means every alert comes from parts nobody
// prices individually, and the flag is ignored by the third shipment. The absolute floor is what makes
// this survive contact with a real invoice.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────────────────────────────
//
// It does not decide whether a divergence is a genuine price rise or a data-entry error. It CANNOT:
// timber going up 40% and an extraction misreading 1,386 as 1,886 are identical in this data, and the
// invoice PDF is the only arbiter. Where the ratio lands on a recognisable shape it names the shape and
// asks — see `shapes()` and the design rule in OUTSTANDING.md §9.

import { landedCost, margin } from '@/lib/catalog/cost-math'

/**
 * Both gates must fire.
 *
 * 10%: below this is FX drift, a different freight quote, a rounding difference in duty. 5% would fire
 * on nearly every European shipment on euro movement alone.
 *
 * 5 (base currency): the floor that keeps cheap SKUs out. A 12% move on a $400 sofa clears it; a 30%
 * move on a $2 fitting does not.
 */
export const DIVERGENCE_RELATIVE = 0.10
export const DIVERGENCE_ABSOLUTE = 5

/** How close a ratio must sit to a candidate factor to be worth naming. */
const SHAPE_TOLERANCE = 0.03

export interface CostRow {
  costPrimary: number | null
  shippingCost: number
  tariffCost: number
  markupPercent: number
  commissionPercent: number
}

/** What the apply would write for one product, per unit, already converted. Mirrors the RPC's CTE. */
export interface ProjectedCost {
  costPrimary: number
  shippingCost: number
  tariffCost: number
  quantity: number
  /** What the apply would WRITE — the shipment's term when it states one, else the row's own. */
  commissionPercent: number
}

export type ShapeKind = 'decimal' | 'currency' | 'pack'

export interface Shape {
  kind: ShapeKind
  /** The factor the two figures differ by — 10, the exchange rate, the pack size. */
  factor: number
  /** Phrased as a disagreement between two figures, never as a verdict on one of them. */
  note: string
}

export interface Divergence {
  productId: string
  productName: string | null
  previousCost: number
  nextCost: number
  /** Signed, in base currency. Positive = the cost went up. */
  delta: number
  /** Signed fraction, e.g. 0.40 for +40%. */
  deltaRelative: number
  /** null when the product has no selling price — a draft has no margin to collapse. */
  price: number | null
  previousMargin: number | null
  nextMargin: number | null
  /** Every recognisable shape the ratio lands on. Usually none; occasionally more than one. */
  shapes: Shape[]
}

export interface DivergenceInput {
  productId: string
  productName: string | null
  /** The cost row this apply would overwrite. Null means there is nothing to overwrite. */
  current: CostRow | null
  next: ProjectedCost
  /** The product's selling price now. Null or 0 for a draft or an unpriced product. */
  price: number | null
  /** Units on the prior invoice for this product, for the pack-size shape. */
  priorQuantity: number | null
  /** The rate on THIS invoice; 1 for a base-currency invoice. */
  exchangeRate: number
}

/**
 * The per-product figures this shipment would write.
 *
 * Mirrors the `per_product` CTE in apply_shipment_costs (add_landed_cost_invoices_3.sql) exactly,
 * including the COALESCE(NULLIF(qty,0),1) rule that treats a missing quantity as one unit. If that
 * expression changes, this changes in the same commit — the preview's whole value is that it predicts
 * the write, and a preview drifting from the write is how the per-unit bug survived as long as it did.
 */
export function projectCost(
  lines: Array<{ extended: number; quantity: number | null; allocatedFreight: number; allocatedDuties: number }>,
  exchangeRate: number,
  commissionPercent: number,
): ProjectedCost {
  const qtySum = lines.reduce((n, l) => n + (l.quantity ?? 0), 0)
  const qty = qtySum === 0 ? 1 : qtySum
  return {
    costPrimary: (lines.reduce((n, l) => n + l.extended, 0) / qty) * exchangeRate,
    shippingCost: lines.reduce((n, l) => n + l.allocatedFreight, 0) / qty,
    tariffCost: lines.reduce((n, l) => n + l.allocatedDuties, 0) / qty,
    quantity: qtySum,
    commissionPercent,
  }
}

const near = (value: number, factor: number, tol = SHAPE_TOLERANCE): boolean =>
  factor > 0 && Math.abs(value - factor) / factor <= tol

/**
 * The recognisable shapes a ratio can land on.
 *
 * Computed over the PURCHASE price (cost_primary), not the landed cost: all three of these errors
 * happen in the invoice's unit price, and freight riding along in the denominator would dilute the
 * ratio out of tolerance on a heavily-freighted line.
 *
 * Every shape returned, not the best one. Two shapes matching (a JPY rate near 100 is also a decimal
 * place) is information, and picking one to report would be exactly the guessing this feature refuses
 * to do. Zero shapes is the common case and means only that the move has no recognisable form — it
 * says nothing about whether the move is real.
 */
export function shapes(
  previousPrimary: number,
  nextPrimary: number,
  exchangeRate: number,
  priorQuantity: number | null,
  nextQuantity: number,
): Shape[] {
  const found: Shape[] = []
  if (previousPrimary <= 0 || nextPrimary <= 0) return found
  const ratio = nextPrimary / previousPrimary

  // A decimal in the wrong place. A price does not rise tenfold.
  for (const f of [10, 100, 0.1, 0.01]) {
    if (near(ratio, f)) {
      found.push({
        kind: 'decimal',
        factor: f,
        note: `These two figures differ by almost exactly ${f >= 1 ? `${f}×` : `1/${Math.round(1 / f)}`} — a decimal place apart. One of them has the point in the wrong position; the invoice says which.`,
      })
    }
  }

  // A line entered in the wrong currency, or the rate applied twice. We know the rate, so this is cheap
  // to test — and skipped entirely at a rate of 1, where it would collide with "no change at all".
  if (Math.abs(exchangeRate - 1) > 0.02) {
    for (const f of [exchangeRate, 1 / exchangeRate]) {
      if (near(ratio, f)) {
        found.push({
          kind: 'currency',
          factor: f,
          note: `These two figures differ by almost exactly the ${exchangeRate} exchange rate — one of them may already be converted while the other is not.`,
        })
      }
    }
  }

  // A pack invoiced as a unit. The signature is the quantity moving by the same factor in the OPPOSITE
  // direction: the line total was divided by the wrong count, so unit cost absorbs whatever the count
  // lost. A quantity that simply doubles between orders does not move the unit cost at all.
  if (priorQuantity && priorQuantity > 0 && nextQuantity > 0) {
    const qtyRatio = priorQuantity / nextQuantity
    const k = Math.round(qtyRatio > 1 ? qtyRatio : 1 / qtyRatio)
    if (k >= 2 && k <= 100 && near(ratio, qtyRatio) && !near(qtyRatio, 1)) {
      found.push({
        kind: 'pack',
        factor: qtyRatio,
        note: `The quantity moved by the same factor in the opposite direction (${priorQuantity} → ${nextQuantity}) — one of these two invoices may be counting a pack where the other counts a unit.`,
      })
    }
  }

  return found
}

/**
 * Whether this product's cost is about to move enough to matter, and what that does to its margin.
 *
 * Returns null — no flag — for the two silent cases: a product with no cost row (nothing is being
 * overwritten) and a reorder at a stable price (the wallpaper case this exists to avoid).
 */
export function assess(input: DivergenceInput): Divergence | null {
  const d = describe(input)
  return d && clearsGates(d) ? d : null
}

/**
 * Does this move clear both thresholds — i.e. is it worth SHOWING?
 *
 * Separate from `describe` because "what this apply did" and "what we showed you" are two different
 * records that happened to coincide until commission arrived. A 25% commission moves every product on
 * a shipment by the same proportion, but the $5 floor means only the ones above ~18.18 of purchase
 * price clear it — so 38 of PRIMAVERA's 126 rows change without being flagged. They are still recorded;
 * they are just not claimed to have been read.
 */
export function clearsGates(d: Divergence): boolean {
  return Math.abs(d.delta) >= DIVERGENCE_ABSOLUTE && Math.abs(d.deltaRelative) >= DIVERGENCE_RELATIVE
}

/**
 * The same arithmetic with no thresholds applied: what this apply would do to this product's cost.
 *
 * Returns null only when there is genuinely nothing to say — no cost row to overwrite, no purchase
 * price on it, or a previous cost of zero that no percentage can be taken against.
 */
export function describe(input: DivergenceInput): Divergence | null {
  const { current, next } = input
  if (!current || current.costPrimary === null) return null

  // markup_percent is deliberately absent from the RPC's UPDATE, so an existing row keeps its snapshot
  // and both sides of this comparison carry the same one. Using today's default here would show a
  // margin change that the apply is not going to cause.
  //
  // COMMISSION IS THE OPPOSITE, and that asymmetry is the point. A shipment that states a commission
  // WILL overwrite the row's snapshot, so the two sides carry different values and the resulting move
  // is real — it is exactly what makes the commission backfill visible instead of silent.
  const previousCost = landedCost({
    costPrimary: current.costPrimary,
    shippingCost: current.shippingCost,
    tariffCost: current.tariffCost,
    markupPercent: current.markupPercent,
    commissionPercent: current.commissionPercent,
  })
  const nextCost = landedCost({
    costPrimary: next.costPrimary,
    shippingCost: next.shippingCost,
    tariffCost: next.tariffCost,
    markupPercent: current.markupPercent,
    commissionPercent: next.commissionPercent,
  })
  if (previousCost === null || nextCost === null || previousCost <= 0) return null

  const delta = nextCost - previousCost
  const deltaRelative = delta / previousCost

  const price = input.price && input.price > 0 ? input.price : null
  return {
    productId: input.productId,
    productName: input.productName,
    previousCost,
    nextCost,
    delta,
    deltaRelative,
    price,
    previousMargin: margin(price, previousCost),
    nextMargin: margin(price, nextCost),
    shapes: shapes(current.costPrimary, next.costPrimary, input.exchangeRate, input.priorQuantity, next.quantity),
  }
}

const money = (n: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
  } catch {
    return `${n.toFixed(2)} ${currency}`
  }
}

const pct = (n: number): string => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(0)}%`

/**
 * The sentence shown on screen and stored in the acknowledgement record.
 *
 * Margin is the subject when there is a price to have one. When there is not — a draft, or a product
 * priced later — it degrades to the cost change and says so, rather than printing a percentage
 * computed against a price of zero. A draft has no margin to collapse, and claiming one would be the
 * nonsense figure that teaches an owner to stop reading the line.
 */
export function divergenceSentence(d: Divergence, currency: string): string {
  const name = d.productName || 'This product'
  const move = `landed cost ${money(d.previousCost, currency)} → ${money(d.nextCost, currency)} (${d.delta > 0 ? '+' : '−'}${Math.abs(d.deltaRelative * 100).toFixed(0)}%)`

  if (d.previousMargin === null || d.nextMargin === null) {
    return `${name} has no selling price yet, so there is no margin to compare — ${move}.`
  }
  const verb = d.nextMargin < d.previousMargin ? 'falls' : 'rises'
  return `${name}: margin ${verb} from ${pct(d.previousMargin)} to ${pct(d.nextMargin)} — ${move}.`
}

/** The heading over a set of them. */
export function divergenceHeadline(list: Divergence[]): string {
  const collapsing = list.filter((d) => d.previousMargin !== null && d.nextMargin !== null && d.nextMargin < d.previousMargin)
  if (collapsing.length === list.length && list.length > 0) {
    return list.length === 1
      ? 'Applying this shipment collapses a margin'
      : `Applying this shipment collapses the margin on ${list.length} products`
  }
  return list.length === 1
    ? 'Applying this shipment moves a cost materially'
    : `Applying this shipment moves ${list.length} costs materially`
}

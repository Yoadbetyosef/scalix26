// The landed-cost and margin arithmetic, in one place.
//
// ISOMORPHIC — no server imports — so the client cost card, the invoice approval preview and the server
// both call the same function. (lib/catalog/costs.ts reaches next/headers and can never be imported by
// a client component; this is its shared half, the same split as lib/orders/attachment-types.ts.)
//
// ── THIS FILE IS A MIRROR, NOT THE SOURCE ───────────────────────────────────────────────────────────
//
// The authoritative definition is the GENERATED column `product_costs.computed_cost`:
//
//     CASE WHEN cost_primary IS NULL THEN NULL
//          ELSE (cost_primary * (1 + commission_percent / 100) + shipping_cost + tariff_cost)
//               * (1 + markup_percent / 100) END
//
// Nothing here ever writes that value — the database calculates it and no client, endpoint or service
// role may store a number that disagrees with its inputs. What this file is for is the two places that
// have to PREDICT the stored figure before it exists: a card previewing what the owner is typing, and
// an approval screen showing what a shipment will do to a product's cost if it is applied.
//
// So this has one job: agree with the column. If the column's expression ever changes, this changes in
// the same commit. It existed as three separate copies of the same expression before this file did.
//
// ── WHY AN OBJECT AND NOT FIVE NUMBERS ──────────────────────────────────────────────────────────────
//
// These were positional arguments until commission made them five numerics in a row, which is one
// transposition away from the per-unit bug's cousin — and that bug survived because two of its own
// tests had baked the wrong denominator in. An object cannot be transposed, and adding a required key
// turns "every place that must now think about commission" into a list the compiler produces rather
// than a list someone remembers.
//
// Nothing here is optional for the same reason. A defaulted `commissionPercent = 0` would let a call
// site silently omit it and quietly under-report a real cost.

export interface CostComponents {
  /** The purchase price of ONE unit, in base currency. Null when unknown — never 0 as a stand-in. */
  costPrimary: number | null
  shippingCost: number
  tariffCost: number
  /**
   * Both percentages are the values SNAPSHOTTED on the row, not today's tenant defaults. Passing a
   * default for an existing row is the bug these names are trying to prevent.
   */
  markupPercent: number
  /**
   * The supplier's commission, charged on the goods only.
   *
   * It applies to `costPrimary` ALONE. Freight and duty do not carry commission — they are paid to a
   * forwarder and a customs authority, not to the supplier's agent. That is why this cannot be folded
   * into markup or applied to the sum: on 100 cost + 20 shipping at 25%, the right answer is 125 + 20,
   * not 150.
   */
  commissionPercent: number
}

/** The goods at what the supplier is actually owed for them — purchase price plus their commission. */
export function goodsWithCommission(c: CostComponents): number | null {
  if (c.costPrimary === null) return null
  return c.costPrimary * (1 + c.commissionPercent / 100)
}

/** The commission portion alone, for a card that shows the owner where the number came from. */
export function commissionAmount(c: CostComponents): number | null {
  if (c.costPrimary === null) return null
  return c.costPrimary * (c.commissionPercent / 100)
}

/**
 * Everything spent getting the unit here, BEFORE markup.
 *
 * Exists because it is the number markup is a percentage OF. Without it on screen, the markup figure
 * is a percentage of something the reader cannot see.
 */
export function subtotalBeforeMarkup(c: CostComponents): number | null {
  const goods = goodsWithCommission(c)
  if (goods === null) return null
  return goods + c.shippingCost + c.tariffCost
}

/**
 * What a product actually costs to have on the shelf: the purchase price plus the supplier's
 * commission on it, plus everything spent getting it there, then the tenant's markup.
 *
 * Returns null when the purchase price is unknown, matching the column's NULL-in-NULL-out rule — a
 * product with no cost recorded must read blank, never $0.00, because "free" and "not yet entered" are
 * different facts.
 */
export function landedCost(c: CostComponents): number | null {
  const subtotal = subtotalBeforeMarkup(c)
  if (subtotal === null) return null
  return subtotal * (1 + c.markupPercent / 100)
}

/** The markup portion alone. A percentage of the subtotal, which includes commission. */
export function markupAmount(c: CostComponents): number | null {
  const subtotal = subtotalBeforeMarkup(c)
  if (subtotal === null) return null
  return subtotal * (c.markupPercent / 100)
}

/**
 * Margin against the selling price: what proportion of the price is not cost.
 *
 * Undefined without both numbers, and undefined at a zero price rather than dividing by it — a product
 * priced at 0 has no meaningful margin, and −Infinity on a screen is worse than a dash.
 */
export function margin(price: number | null, cost: number | null): number | null {
  if (price === null || cost === null || price <= 0) return null
  return ((price - cost) / price) * 100
}

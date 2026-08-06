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
//          ELSE (cost_primary + shipping_cost + tariff_cost) * (1 + markup_percent / 100) END
//
// Nothing here ever writes that value — the database calculates it and no client, endpoint or service
// role may store a number that disagrees with its inputs. What this file is for is the two places that
// have to PREDICT the stored figure before it exists: a card previewing what the owner is typing, and
// an approval screen showing what a shipment will do to a product's cost if it is applied.
//
// So this has one job: agree with the column. If the column's expression ever changes, this changes in
// the same commit. It existed as three separate copies of the same expression before this file did.

/**
 * What a product actually costs to have on the shelf: the purchase price plus everything spent getting
 * it there, then the tenant's markup.
 *
 * Returns null when the purchase price is unknown, matching the column's NULL-in-NULL-out rule — a
 * product with no cost recorded must read blank, never $0.00, because "free" and "not yet entered" are
 * different facts.
 *
 * `markupPercent` is the value SNAPSHOTTED on the row, not today's tenant default. Passing the default
 * for an existing row is the bug this parameter's name is trying to prevent.
 */
export function landedCost(
  costPrimary: number | null,
  shippingCost: number,
  tariffCost: number,
  markupPercent: number,
): number | null {
  if (costPrimary === null) return null
  return (costPrimary + shippingCost + tariffCost) * (1 + markupPercent / 100)
}

/** The markup portion alone, for a card that shows the owner where the number came from. */
export function markupAmount(
  costPrimary: number | null,
  shippingCost: number,
  tariffCost: number,
  markupPercent: number,
): number | null {
  if (costPrimary === null) return null
  return (costPrimary + shippingCost + tariffCost) * (markupPercent / 100)
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

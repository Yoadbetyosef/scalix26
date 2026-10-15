// Selling price from the supplier's invoice price, per tenant.
//
// ISOMORPHIC and PURE, like cost-math.ts — the rule is one multiplication and has to be checkable
// without a database.
//
// ── WHAT THE PRICE IS A MULTIPLE OF ─────────────────────────────────────────────────────────────────
//
// `product_costs.cost_primary` — what ONE unit cost on the supplier's invoice, converted to base
// currency at the invoice's rate. NOT `computed_cost`: commission, freight, duty and markup still feed
// the landed cost (and so the margin the cost card shows), but they no longer move the price. That is
// the owner's decision for Your Design Collective (15 Oct 2026), replacing round(computed_cost × 3).
//
// Rugs carry their own multiple. A tenant with no multiplier set gets no automatic pricing at all —
// null means "this business prices by hand", never "multiply by 1".

export interface PricingRule {
  multiplier: number | null
  rugMultiplier: number | null
}

const RUG = /\b(rugs?|dhurries|dhurrie|carpets?|kilims?)\b|שטיח/i

/** A rug by category first, by name otherwise — supplier invoices rarely carry a category. */
export function isRug(p: { name?: string | null; category?: string | null }): boolean {
  if (p.category && RUG.test(p.category)) return true
  return RUG.test(p.name ?? '')
}

/**
 * Whole dollars, no cents. Null when there is nothing to price from: an unknown or zero invoice price
 * must leave the existing price alone rather than write $0.
 */
export function salePrice(costPrimary: number | null, rug: boolean, rule: PricingRule): number | null {
  if (costPrimary === null || !(costPrimary > 0)) return null
  const m = rug ? (rule.rugMultiplier ?? rule.multiplier) : rule.multiplier
  if (m === null || !(m > 0)) return null
  return Math.round(costPrimary * m)
}

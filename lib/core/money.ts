// Deterministic, server-side money math. Integer minor units (cents) ONLY — never floating point for
// totals. The single source of truth for line + document totals. Pure & unit-tested.

export interface LineAmounts { quantity: number; unit_price_cents: number; discount_cents?: number; tax_cents?: number }

// Line total = round(qty × unit) − discount (floored at 0) + tax. All integer cents.
export function lineTotalCents(l: LineAmounts): number {
  const gross = Math.round(l.quantity * l.unit_price_cents)
  const afterDiscount = Math.max(0, gross - (l.discount_cents ?? 0))
  return afterDiscount + (l.tax_cents ?? 0)
}

export interface DocumentTotals { subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number }

export function documentTotals(lines: LineAmounts[]): DocumentTotals {
  let subtotal = 0, discount = 0, tax = 0
  for (const l of lines) {
    subtotal += Math.round(l.quantity * l.unit_price_cents)
    discount += l.discount_cents ?? 0
    tax += l.tax_cents ?? 0
  }
  const total = Math.max(0, subtotal - discount) + tax
  return { subtotal_cents: subtotal, discount_cents: discount, tax_cents: tax, total_cents: total }
}

// Proposal totals: line-level discounts PLUS a document-level (overall) discount and a document-level tax.
// subtotal = Σ gross; discount = Σ line discounts + overall; total = max(0, subtotal − discount) + tax.
export function proposalTotals(lines: LineAmounts[], overallDiscountCents: number, taxCents: number): DocumentTotals {
  let subtotal = 0, lineDisc = 0
  for (const l of lines) { subtotal += Math.round(l.quantity * l.unit_price_cents); lineDisc += l.discount_cents ?? 0 }
  const discount = lineDisc + Math.max(0, overallDiscountCents)
  const total = Math.max(0, subtotal - discount) + Math.max(0, taxCents)
  return { subtotal_cents: subtotal, discount_cents: discount, tax_cents: taxCents, total_cents: total }
}

// Deposit helper (fixed cents or percent of total), server-computed, integer cents.
export function depositCents(totalCents: number, spec: { kind: 'fixed'; cents: number } | { kind: 'percent'; percent: number }): number {
  if (spec.kind === 'fixed') return Math.max(0, Math.min(totalCents, Math.round(spec.cents)))
  return Math.max(0, Math.min(totalCents, Math.round((totalCents * spec.percent) / 100)))
}

// ── A DISCOUNT ON THE WHOLE INVOICE ─────────────────────────────────────────────────────────────
//
// Chosen as a percent OR a dollar amount, and turned into cents here, once. It is then SPREAD over the
// lines' discount_cents in proportion to each line's gross, so sales tax (charged per line) is on the
// price the customer actually pays, and documentTotals above needs no second discount path.
export type DocDiscount = { kind: 'percent'; value: number } | { kind: 'amount'; value: number }

/** The discount in cents for a subtotal. Percent is capped at 100, an amount at the subtotal. */
export function docDiscountCents(subtotalCents: number, d: DocDiscount | null | undefined): number {
  if (!d || !(d.value > 0) || subtotalCents <= 0) return 0
  if (d.kind === 'percent') return Math.round((subtotalCents * Math.min(100, d.value)) / 100)
  return Math.min(subtotalCents, Math.round(d.value * 100))
}

/** Split `discountCents` across lines by gross, largest remainder — the parts always sum exactly. */
export function spreadDiscount(grossCents: number[], discountCents: number): number[] {
  const total = grossCents.reduce((s, g) => s + Math.max(0, g), 0)
  if (total <= 0 || discountCents <= 0) return grossCents.map(() => 0)
  const d = Math.min(discountCents, total)
  const exact = grossCents.map((g) => (Math.max(0, g) * d) / total)
  const parts = exact.map(Math.floor)
  let left = d - parts.reduce((s, p) => s + p, 0)
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) { if (left <= 0) break; parts[i] += 1; left -= 1 }
  return parts
}

/** "Discount (10%)" when chosen as a percent, plain "Discount" when chosen as an amount. */
export function discountLabel(kind: string | null | undefined, value: number | null | undefined): string {
  if (kind === 'percent' && value && value > 0) return `Discount (${Number(value.toFixed(2))}%)`
  return 'Discount'
}

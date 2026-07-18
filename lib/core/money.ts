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

// Deposit helper (fixed cents or percent of total), server-computed, integer cents.
export function depositCents(totalCents: number, spec: { kind: 'fixed'; cents: number } | { kind: 'percent'; percent: number }): number {
  if (spec.kind === 'fixed') return Math.max(0, Math.min(totalCents, Math.round(spec.cents)))
  return Math.max(0, Math.min(totalCents, Math.round((totalCents * spec.percent) / 100)))
}

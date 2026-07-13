// Integer-cent money for the CEO Command Center forecast engine.
//
// Money is ALWAYS integer cents — there is no floating-point currency stored or settled. Rates/percentages
// are plain fractions (0.20 = 20%). Intermediate arithmetic (cents × rate, customers × price) stays far
// within IEEE-754's exact-integer range (2^53 ≈ 9.0e15; a $1B valuation is 1e11 cents), and every monetary
// result is rounded to a whole cent deterministically (half-up) before it is stored or aggregated.

export type Cents = number

export const toCents = (dollars: number): Cents => Math.round(dollars * 100)
export const toDollars = (c: Cents): number => c / 100

// Deterministic half-up rounding to a whole cent (symmetric around zero).
export function roundCents(x: number): Cents {
  return x < 0 ? -Math.round(-x) : Math.round(x)
}

// Apply a rate (fraction) to a cent amount → whole cents, half-up.
export function applyRate(c: Cents, rate: number): Cents {
  return roundCents(c * rate)
}

// Multiply a per-unit cent price by a (possibly fractional) unit count → whole cents.
export function scaleCents(unitCents: Cents, units: number): Cents {
  return roundCents(unitCents * units)
}

export const asPct = (whole: number): number => whole / 100 // 20 → 0.20
export const sumCents = (xs: Cents[]): Cents => xs.reduce((a, b) => a + b, 0)

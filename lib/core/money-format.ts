// Pure cents↔display helpers for the Core UI. Money is integer minor units (cents) end-to-end; these only
// format for display and parse form input back to integer cents. Server stays authoritative.

export function formatCents(cents: number | null | undefined, currency = 'usd'): string {
  if (cents == null) return '—'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}

// A cents value as a plain decimal string for a form input (e.g. 129900 → "1299.00"). Empty for null.
export function centsToInput(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toFixed(2)
}

// Parse a user-entered dollars string into integer cents. Returns null for empty; NaN sentinel handled by caller.
export function inputToCents(input: string): number | null {
  const t = input.trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return NaN
  return Math.round(n * 100)
}

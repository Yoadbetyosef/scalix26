// SALES TAX — a rate the business is in, never a number somebody types.
//
// The rate comes from the tenant's STATE (tenants.state), looked up in this table. A free-text cents
// box invites somebody to type a figure they computed wrong; a toggle against a known rate does not.
// A state that is not in the table has no rate, and the toggle is not offered — better no field than
// a guessed one.
//
// New Jersey: one statewide rate, 6.625%, and no county or local add-on — Bergen County included.
// (Urban Enterprise Zones charge half to qualifying sellers; that is an exemption a seller is certified
// for, not a location rule, so it is not modelled here.)

export interface SalesTaxRate { state: string; rate: number; label: string }

const RATES: Record<string, SalesTaxRate> = {
  NJ: { state: 'NJ', rate: 0.06625, label: 'NJ sales tax (6.625%)' },
}

const NAMES: Record<string, string> = { 'NEW JERSEY': 'NJ' }

export function salesTaxFor(state: string | null | undefined): SalesTaxRate | null {
  const s = (state ?? '').trim().toUpperCase()
  return RATES[NAMES[s] ?? s] ?? null
}

/** Tax on one line, in whole cents: the rate on what is left after the line's discount. */
export function lineTaxCents(line: { quantity: number; unit_price_cents: number; discount_cents?: number }, rate: number): number {
  const net = Math.max(0, Math.round(line.quantity * line.unit_price_cents) - (line.discount_cents ?? 0))
  return Math.round(net * rate)
}

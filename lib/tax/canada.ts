// Canadian sales tax, by PLACE OF SUPPLY.
//
// The rate follows the DELIVERY DESTINATION, not the seller's address. A Vancouver jeweller shipping
// to Toronto charges 13% HST, not 12% BC. Getting this backwards is the single most common Canadian
// tax error and it is invisible on the document — the arithmetic looks right, it is just the wrong
// rate — so the province lives on the ORDER and every function here takes a destination.

/** Provinces and territories, in the order a Canadian would expect to see them listed. */
export const CA_REGIONS = [
  { code: 'BC', name: 'British Columbia' },
  { code: 'AB', name: 'Alberta' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'ON', name: 'Ontario' },
  { code: 'QC', name: 'Quebec' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'YT', name: 'Yukon' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
] as const

export interface TaxRate { region: string; label: string; ratePercent: number; effectiveFrom: string }

/**
 * The bundled table — a FALLBACK, not the source of truth.
 *
 * tax_rates in the database is authoritative, because rates change and a rate compiled into the
 * application means a deploy to correct arithmetic that is already wrong on documents that have gone
 * out. This copy exists so a document still renders correctly before the migration is run, and so a
 * transient database failure does not blank the tax line on a customer's invoice.
 *
 * Kept in step with the migration's seed by lib/tax/canada.test.ts, which fails if they disagree.
 */
export const CA_RATES_FALLBACK: TaxRate[] = [
  { region: 'BC', label: 'GST + PST', ratePercent: 12, effectiveFrom: '2000-01-01' },
  { region: 'AB', label: 'GST', ratePercent: 5, effectiveFrom: '2000-01-01' },
  { region: 'SK', label: 'GST + PST', ratePercent: 11, effectiveFrom: '2000-01-01' },
  { region: 'MB', label: 'GST + PST', ratePercent: 12, effectiveFrom: '2000-01-01' },
  { region: 'ON', label: 'HST', ratePercent: 13, effectiveFrom: '2000-01-01' },
  { region: 'QC', label: 'GST + QST', ratePercent: 14.975, effectiveFrom: '2000-01-01' },
  { region: 'NB', label: 'HST', ratePercent: 15, effectiveFrom: '2000-01-01' },
  // Nova Scotia dropped from 15 to 14 on 1 April 2025. BOTH rows are kept so a document raised before
  // that date can still be explained rather than silently recomputed at today's rate.
  { region: 'NS', label: 'HST', ratePercent: 15, effectiveFrom: '2000-01-01' },
  { region: 'NS', label: 'HST', ratePercent: 14, effectiveFrom: '2025-04-01' },
  { region: 'PE', label: 'HST', ratePercent: 15, effectiveFrom: '2000-01-01' },
  { region: 'NL', label: 'HST', ratePercent: 15, effectiveFrom: '2000-01-01' },
  { region: 'YT', label: 'GST', ratePercent: 5, effectiveFrom: '2000-01-01' },
  { region: 'NT', label: 'GST', ratePercent: 5, effectiveFrom: '2000-01-01' },
  { region: 'NU', label: 'GST', ratePercent: 5, effectiveFrom: '2000-01-01' },
]

/**
 * The rate in force for a region on a given date.
 *
 * The newest row not later than `on` — so a rate is current until a later one supersedes it, and an
 * invoice dated before a change keeps the rate it was actually charged at.
 *
 * Returns null for an unknown or absent region. Null means "we do not know", and the document shows
 * no tax line at all rather than a zero — a 0% line is a claim that no tax is due, which is a
 * different and more dangerous statement than saying nothing.
 */
export function rateFor(region: string | null | undefined, rates: TaxRate[], on?: Date): TaxRate | null {
  if (!region) return null
  const code = region.trim().toUpperCase()
  const date = (on ?? new Date()).toISOString().slice(0, 10)
  const candidates = rates
    .filter((r) => r.region.toUpperCase() === code && r.effectiveFrom <= date)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
  return candidates[0] ?? null
}

export interface TaxLine { label: string; ratePercent: number; amountCents: number; region: string }

/**
 * Tax on a subtotal, in whole cents.
 *
 * Rounded half-up at the end rather than per line: a Canadian invoice states one tax amount on one
 * subtotal, and summing per-line roundings produces a figure that does not match what the rate times
 * the subtotal gives — which is the number a customer checks with a calculator.
 */
export function taxOn(subtotalCents: number, rate: TaxRate | null): TaxLine | null {
  if (!rate) return null
  return {
    label: rate.label,
    ratePercent: rate.ratePercent,
    region: rate.region,
    amountCents: Math.round((subtotalCents * rate.ratePercent) / 100),
  }
}

/** "HST 13%" — what the document prints beside the amount. */
export const taxLabel = (t: TaxLine): string =>
  `${t.label} ${t.ratePercent % 1 === 0 ? t.ratePercent : t.ratePercent.toFixed(3)}%`

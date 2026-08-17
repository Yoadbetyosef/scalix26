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

// ── WHAT THE SELLER PICKS ───────────────────────────────────────────────────────────────────────
//
// Everything above answers "what is the statutory rate in this region on this date". This answers a
// different question: "which reading of it did I charge?" — and for three provinces there are two
// correct answers.
//
// BC, SK and MB levy a provincial tax SEPARATE from GST, and that provincial part is exemptible on a
// sale to a business for resale. So a BC sale is 12% (GST + PST) at retail and 5% (GST alone) when the
// provincial part does not apply. BOTH are correct. Nothing in the data can tell them apart — the
// difference is a certificate in the seller's filing cabinet — so the seller chooses, per sale.
//
// HST provinces do not split. One rate, applied either way, nothing to choose. Alberta and the three
// territories have no provincial sales tax to exempt, so their GST 5% is the only reading there is.
//
// QUEBEC IS GST-ONLY HERE, DELIBERATELY. QST is a separate return with separate registration, and a
// combined 14.975% line is a figure nobody can reconcile against either filing. The 14.975% row stays
// in tax_rates as the statutory reference; it is not offered as a choice.
//
// ── THIS LIST IS THE PICKER, NOT THE RATE TABLE ─────────────────────────────────────────────────
//
// tax_rates is keyed UNIQUE (country, region, effective_from) — its only axis for two rows in one
// province is TIME, which is right for what it does (NS 15% → 14% in April 2025) and wrong for this.
// So the choices live here, the CHOSEN one is snapshotted onto the order, and tax_rates keeps its
// single job. See supabase/migrations/add_order_tax_choice.sql.

/** Which reading of a province's tax was charged. Describes the RATE, never the customer. */
export type TaxKind = 'gst_only' | 'combined'

export interface TaxChoice {
  /** Stable, and what the form posts. The server resolves everything else from it. */
  id: string
  region: string
  kind: TaxKind | null
  label: string
  ratePercent: number
  /** The half-sentence beside the rate. Says which sale it is without requiring any tax law. */
  hint: string | null
}

const choice = (region: string, kind: TaxKind | null, label: string, ratePercent: number, hint: string | null = null): TaxChoice =>
  ({ id: kind ? `${region}:${kind}` : region, region, kind, label, ratePercent, hint })

/**
 * Every province, both readings where both apply, in the order a Canadian expects them listed.
 *
 * The two readings sit ADJACENT on purpose. "GST 5%" directly beneath "GST + PST 12%" is enough to
 * choose between without knowing what PST is — she knows which sale she made, and the pair makes the
 * question obvious where a single entry would hide it.
 */
export const TAX_CHOICES: TaxChoice[] = [
  choice('BC', 'combined', 'GST + PST', 12, 'retail'),
  choice('BC', 'gst_only', 'GST', 5, 'wholesale for resale'),
  choice('AB', null, 'GST', 5),
  choice('SK', 'combined', 'GST + PST', 11, 'retail'),
  choice('SK', 'gst_only', 'GST', 5, 'wholesale for resale'),
  choice('MB', 'combined', 'GST + RST', 12, 'retail'),
  choice('MB', 'gst_only', 'GST', 5, 'wholesale for resale'),
  choice('ON', null, 'HST', 13),
  choice('QC', null, 'GST', 5),
  choice('NB', null, 'HST', 15),
  choice('NS', null, 'HST', 14),
  choice('PE', null, 'HST', 15),
  choice('NL', null, 'HST', 15),
  choice('YT', null, 'GST', 5),
  choice('NT', null, 'GST', 5),
  choice('NU', null, 'GST', 5),
]

/**
 * Resolve what the form posted.
 *
 * The form posts an ID and NEVER a rate. A client that could send its own percentage could put 3% on
 * a customer's invoice, and the figure would look entirely ordinary. Everything stored is read from
 * this list on the server.
 */
export const taxChoiceById = (id: string | null | undefined): TaxChoice | null =>
  (id ? TAX_CHOICES.find((c) => c.id === id) ?? null : null)

/** The stored snapshot, as a TaxLine. Null unless BOTH halves are present — see the migration. */
export function taxFromSnapshot(
  region: string | null | undefined,
  label: string | null | undefined,
  ratePercent: number | null | undefined,
  subtotalCents: number,
): TaxLine | null {
  if (!region || !label || ratePercent === null || ratePercent === undefined) return null
  return taxOn(subtotalCents, { region, label, ratePercent, effectiveFrom: '' })
}

// DOES THIS BUSINESS RECOVER THE TAX ON ITS EXPENSES?
//
// The answer decides whether the add sheet shows a second money field. A locksmith in New Jersey
// should see an amount and nothing else — sales tax there is part of what the thing cost, there is
// nothing to reclaim, and a "Tax" box beside the total is a question with no right answer that will
// get filled in wrong.
//
// A Canadian GST/HST registrant is in the opposite position: the tax on a business purchase is an
// input tax credit, recoverable against the tax they collect. Recording the receipt total as the
// expense overstates their deduction AND forfeits the credit — wrong twice, in the same row.
//
// ── WHY IT IS INFERRED RATHER THAN CONFIGURED ───────────────────────────────────────────────────
//
// There is no country on a tenant. Measured, not assumed: `tenants` has address/city/state/zip and no
// `country`; 3 of 33 tenants have a state at all; and the one Canadian tenant reads state='bc' with
// timezone='America/New_York', so the timezone would actively get it wrong.
//
// Adding a country field would mean asking 33 existing businesses a question to fix a screen they
// have not seen yet. Both signals below are things a tenant has ALREADY told us by working:
//
//   1. A state that is a Canadian province code.
//   2. Any order raised with a delivery province — the place-of-supply picker on the order form,
//      which only has Canadian entries in it (lib/tax/canada.ts).
//
// Either is enough. The second catches a business whose address was never filled in but who has been
// charging GST for months; the first catches one who filled the address in and has not raised an
// order yet.
//
// ── AND WHY GUESSING WRONG IS SURVIVABLE IN ONLY ONE DIRECTION ──────────────────────────────────
//
// A false NEGATIVE hides a field: a Canadian registrant records gross totals and their accountant
// re-splits them later, annoying but recoverable from the receipts.
// A false POSITIVE shows a US business a tax box: they type their sales tax into it, and the export
// then claims a credit that does not exist in their country.
//
// So the signals are deliberately narrow — a province code, or an actual Canadian order. Neither
// fires by accident, and neither fires for any of the 32 non-Canadian tenants today.

import { CA_REGIONS } from '@/lib/tax/canada'

// Widened to string deliberately: CA_REGIONS is `as const`, so the inferred Set would only accept the
// thirteen literals — and the value being tested here is free text a person typed.
const CA_CODES: Set<string> = new Set(CA_REGIONS.map((r) => r.code))

/** Is this free-text state field a Canadian province? 'bc', 'BC ' and 'Bc' all are; 'New York' is not. */
export const isCanadianRegion = (state: string | null | undefined): boolean =>
  !!state && CA_CODES.has(state.trim().toUpperCase())

export interface TaxSignals {
  /** tenants.state, as typed. Free text on every tenant. */
  state: string | null
  /** True if ANY order for this tenant carries a delivery_province. */
  hasCanadianOrder: boolean
}

/** Whether the add sheet offers a recoverable-tax field. See the header for why either signal alone is enough. */
export const recoversTaxOnExpenses = (s: TaxSignals): boolean =>
  isCanadianRegion(s.state) || s.hasCanadianOrder

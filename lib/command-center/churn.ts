// Churn / retention — ONE canonical implementation. Denominators are locked: newly acquired customers are
// NOT in the beginning-customer count, and new MRR is NOT in NRR. Excluded tenants (internal/test/free)
// are removed upstream (see exclusions.ts). Pure + golden-tested.

export interface RetentionPeriod {
  // Population at the START of the period (excludes anyone acquired during the period).
  beginningCustomers: number
  lostCustomers: number // logos lost during the period (per the accounting policy for suspended/paused)
  beginningMrrCents: number
  churnedMrrCents: number
  contractionMrrCents: number
  expansionMrrCents: number // expansion from EXISTING customers only (never new-customer revenue)
}

export function logoChurn(p: RetentionPeriod): number {
  return p.beginningCustomers > 0 ? p.lostCustomers / p.beginningCustomers : 0
}

// Gross revenue churn = (churned + contraction) / beginning MRR.
export function grossRevenueChurn(p: RetentionPeriod): number {
  return p.beginningMrrCents > 0 ? (p.churnedMrrCents + p.contractionMrrCents) / p.beginningMrrCents : 0
}
export const grossRevenueRetention = (p: RetentionPeriod): number => 1 - grossRevenueChurn(p)

// NRR = (beginning − churn − contraction + expansion) / beginning. New revenue is explicitly excluded.
export function nrr(p: RetentionPeriod): number {
  if (p.beginningMrrCents <= 0) return 1
  return (p.beginningMrrCents - p.churnedMrrCents - p.contractionMrrCents + p.expansionMrrCents) / p.beginningMrrCents
}

export interface RetentionSummary {
  logoChurn: number
  grossRevenueChurn: number
  grossRevenueRetention: number
  nrr: number
  churnedMrrCents: number
  contractionMrrCents: number
  expansionMrrCents: number
  netRetainedMrrCents: number
}
export function summarize(p: RetentionPeriod): RetentionSummary {
  return {
    logoChurn: logoChurn(p),
    grossRevenueChurn: grossRevenueChurn(p),
    grossRevenueRetention: grossRevenueRetention(p),
    nrr: nrr(p),
    churnedMrrCents: p.churnedMrrCents,
    contractionMrrCents: p.contractionMrrCents,
    expansionMrrCents: p.expansionMrrCents,
    netRetainedMrrCents: p.beginningMrrCents - p.churnedMrrCents - p.contractionMrrCents + p.expansionMrrCents,
  }
}

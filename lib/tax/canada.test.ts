import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { CA_RATES_FALLBACK, CA_REGIONS, rateFor, taxLabel, taxOn } from './canada'

// Canadian tax is decided by PLACE OF SUPPLY — the delivery destination, not the seller's address.
// Getting it backwards is invisible on the document: the arithmetic looks right, it is just the wrong
// rate. These assertions pin the rates and the rule.

describe('rates', () => {
  it('covers all 13 provinces and territories', () => {
    for (const r of CA_REGIONS) expect(rateFor(r.code, CA_RATES_FALLBACK)).not.toBeNull()
  })

  it.each([
    ['BC', 12], ['AB', 5], ['SK', 11], ['MB', 12], ['ON', 13], ['QC', 14.975],
    ['NB', 15], ['NS', 14], ['PE', 15], ['NL', 15], ['YT', 5], ['NT', 5], ['NU', 5],
  ])('%s is %s%%', (region, pct) => {
    expect(rateFor(region, CA_RATES_FALLBACK)!.ratePercent).toBe(pct)
  })

  it('honours the Nova Scotia change on 1 April 2025 in BOTH directions', () => {
    // A rate is current until a later row supersedes it, so an invoice dated before the change keeps
    // the rate it was actually charged at. Recomputing history at today's rate would silently restate
    // a document the customer already has.
    expect(rateFor('NS', CA_RATES_FALLBACK, new Date('2025-03-31'))!.ratePercent).toBe(15)
    expect(rateFor('NS', CA_RATES_FALLBACK, new Date('2025-04-01'))!.ratePercent).toBe(14)
  })

  it('is case and whitespace tolerant, because a province arrives from a form', () => {
    expect(rateFor(' on ', CA_RATES_FALLBACK)!.ratePercent).toBe(13)
    expect(rateFor('bc', CA_RATES_FALLBACK)!.ratePercent).toBe(12)
  })

  it('returns null for an unknown or absent region rather than guessing', () => {
    for (const v of [null, undefined, '', 'XX', 'CA']) expect(rateFor(v, CA_RATES_FALLBACK)).toBeNull()
  })
})

describe('the bundled table matches the migration', () => {
  it('every seeded rate appears in the fallback', () => {
    // The database is authoritative and this copy is the fallback. If they disagree, a document
    // rendered before the migration runs shows a different figure from one rendered after — which is
    // exactly the kind of silent discrepancy this project keeps finding.
    const sql = readFileSync('supabase/migrations/add_orders_6_estimates_tax_templates.sql', 'utf8')
    const seeded = [...sql.matchAll(/\('CA','([A-Z]{2})','[^']*',\s*([\d.]+),\s*'(\d{4}-\d{2}-\d{2})'\)/g)]
      .map((m) => ({ region: m[1], ratePercent: Number(m[2]), effectiveFrom: m[3] }))
    expect(seeded.length).toBeGreaterThanOrEqual(13)
    for (const row of seeded) {
      const match = CA_RATES_FALLBACK.find(
        (f) => f.region === row.region && f.effectiveFrom === row.effectiveFrom && f.ratePercent === row.ratePercent)
      expect(match, `${row.region} @ ${row.effectiveFrom} = ${row.ratePercent}% is in the migration but not the fallback`).toBeTruthy()
    }
  })
})

describe('taxOn', () => {
  const on = (region: string) => rateFor(region, CA_RATES_FALLBACK)

  it('computes against the DESTINATION, not the seller', () => {
    // The worked example: a BC business delivering to Ontario charges 13%, not 12%.
    expect(taxOn(100_000, on('ON'))!.amountCents).toBe(13_000)
    expect(taxOn(100_000, on('BC'))!.amountCents).toBe(12_000)
  })

  it('rounds half-up on the whole subtotal, not per line', () => {
    // A customer checks the invoice with a calculator: rate times subtotal. Summing per-line
    // roundings produces a figure that does not match what they compute.
    expect(taxOn(1_999, on('QC'))!.amountCents).toBe(299) // 1999 * 14.975% = 299.35
    expect(taxOn(3_333, on('ON'))!.amountCents).toBe(433) // 3333 * 13% = 433.29
  })

  it('is null when the rate is unknown — never a zero line', () => {
    // A 0% line is a CLAIM that no tax is due. Saying nothing is the honest alternative.
    expect(taxOn(100_000, null)).toBeNull()
  })

  it('labels the rate so the customer can check it', () => {
    expect(taxLabel(taxOn(100_000, on('ON'))!)).toBe('HST 13%')
    expect(taxLabel(taxOn(100_000, on('QC'))!)).toBe('GST + QST 14.975%')
    expect(taxLabel(taxOn(100_000, on('BC'))!)).toBe('GST + PST 12%')
  })
})

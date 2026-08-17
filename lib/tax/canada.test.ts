import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { CA_RATES_FALLBACK, CA_REGIONS, TAX_CHOICES, rateFor, taxChoiceById, taxFromSnapshot, taxLabel, taxOn } from './canada'

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

describe('what the seller picks', () => {
  it('offers both readings for exactly the three provinces that split', () => {
    // BC, SK and MB levy a provincial tax SEPARATE from GST, and that part is exemptible on a sale for
    // resale. HST provinces have one rate that applies either way — there is nothing to choose, and
    // offering a second entry would invent a decision.
    const twice = [...new Set(TAX_CHOICES.map((c) => c.region))]
      .filter((r) => TAX_CHOICES.filter((c) => c.region === r).length > 1)
    expect(twice.sort()).toEqual(['BC', 'MB', 'SK'])
  })

  it('and every split pair is a combined rate and a GST-only one, adjacent', () => {
    for (const region of ['BC', 'SK', 'MB']) {
      const pair = TAX_CHOICES.filter((c) => c.region === region)
      expect(pair.map((c) => c.kind)).toEqual(['combined', 'gst_only'])
      expect(pair[1].ratePercent).toBe(5)
      expect(pair[0].ratePercent).toBeGreaterThan(5)
      // The distinction has to read without knowing tax law.
      expect(pair[0].hint).toBe('retail')
      expect(pair[1].hint).toBe('wholesale for resale')
    }
  })

  it('covers all 13 regions, and only offers a kind where there is a choice', () => {
    expect(new Set(TAX_CHOICES.map((c) => c.region)).size).toBe(CA_REGIONS.length)
    for (const c of TAX_CHOICES) {
      if (['BC', 'SK', 'MB'].includes(c.region)) expect(c.kind).not.toBeNull()
      else expect(c.kind, c.region).toBeNull()
    }
  })

  it('every non-split choice matches the statutory table', () => {
    // The picker and tax_rates must not disagree about a province with only one reading — that would
    // be two answers to a question that has one.
    for (const c of TAX_CHOICES.filter((x) => x.kind === null || x.kind === 'combined')) {
      if (c.region === 'QC') continue // GST-only by choice; see below
      expect(rateFor(c.region, CA_RATES_FALLBACK)!.ratePercent, c.region).toBe(c.ratePercent)
    }
  })

  it('Quebec is GST-only in the picker and 14.975% in the table, deliberately', () => {
    // QST is a separate return with separate registration, and a combined line reconciles against
    // neither filing. The statutory row stays as the reference; it is not offered as a choice.
    expect(TAX_CHOICES.find((c) => c.region === 'QC')!.ratePercent).toBe(5)
    expect(rateFor('QC', CA_RATES_FALLBACK)!.ratePercent).toBe(14.975)
  })

  it('resolves by id, and refuses anything not on the list', () => {
    // The form posts an id and never a rate: a client that could send its own percentage could put 3%
    // on a customer's invoice, and the figure would look entirely ordinary.
    expect(taxChoiceById('BC:gst_only')!.ratePercent).toBe(5)
    expect(taxChoiceById('BC:combined')!.ratePercent).toBe(12)
    expect(taxChoiceById('ON')!.label).toBe('HST')
    for (const bad of [null, undefined, '', 'BC', 'ON:combined', 'XX', 'BC:wholesale']) {
      expect(taxChoiceById(bad), String(bad)).toBeNull()
    }
  })

  it('ids are unique and stable', () => {
    // They are stored on orders indirectly (province + kind), so a renamed id would orphan a snapshot.
    expect(new Set(TAX_CHOICES.map((c) => c.id)).size).toBe(TAX_CHOICES.length)
  })
})

describe('the snapshot, not the table', () => {
  it('renders what was stored, at any rate the table no longer holds', () => {
    // The point of the snapshot: editing tax_rates next year must not alter a document a customer
    // already holds. 7% is not in the table and never was.
    const line = taxFromSnapshot('BC', 'GST + PST', 7, 100_000)!
    expect(line.amountCents).toBe(7_000)
    expect(taxLabel(line)).toBe('GST + PST 7%')
  })

  it('a BC order can be 5% or 12%, and the snapshot is the only thing that knows which', () => {
    expect(taxFromSnapshot('BC', 'GST', 5, 100_000)!.amountCents).toBe(5_000)
    expect(taxFromSnapshot('BC', 'GST + PST', 12, 100_000)!.amountCents).toBe(12_000)
    // A live lookup could not pick between them even if rates never changed.
    expect(rateFor('BC', CA_RATES_FALLBACK)!.ratePercent).toBe(12)
  })

  it('a HALF snapshot renders nothing — the state the migration forbids', () => {
    // A label with no rate prints "GST + PST" beside nothing; a rate with no label prints a figure the
    // customer cannot identify. Both are worse than no tax line.
    expect(taxFromSnapshot('BC', 'GST', null, 100_000)).toBeNull()
    expect(taxFromSnapshot('BC', null, 5, 100_000)).toBeNull()
    expect(taxFromSnapshot(null, 'GST', 5, 100_000)).toBeNull()
  })
})

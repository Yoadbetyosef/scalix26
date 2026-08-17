import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const store = read('./store.ts')
const docData = read('./document-data.ts')
const body = read('../../components/orders/document-body.tsx')
const form = read('../../components/orders/order-edit.tsx')
const schema = read('./schema.ts')
const migration = read('../../supabase/migrations/add_order_tax_choice.sql')

describe('the rate is resolved on the SERVER', () => {
  it('the form posts an id and never a percentage', () => {
    // A client that could send its own rate could put 3% on a customer's invoice, and the figure would
    // look entirely ordinary.
    expect(form).toContain('taxChoiceId: f.taxChoiceId || null')
    expect(strip(form)).not.toMatch(/ratePercent:|tax_rate_percent|taxLabel:/)
    expect(schema).toContain('taxChoiceId: z.string().max(24).nullable().optional()')
    expect(strip(schema)).not.toMatch(/taxRatePercent|taxLabel/)
  })

  it('and the server reads label, rate and PROVINCE off the list', () => {
    expect(store).toContain('const picked = taxChoiceById(patch.taxChoiceId ?? null)')
    expect(store).toContain('delivery_province: picked.region')
    expect(store).toContain('tax_label: picked.label')
    expect(store).toContain('tax_rate_percent: picked.ratePercent')
  })

  it('picking the rate sets the place of supply with it — one control, not two', () => {
    // Two controls made it possible to store a rate from one province and a destination from another.
    expect(form).not.toContain('deliveryProvince: f.deliveryProvince')
    expect(form).toContain("import { TAX_CHOICES } from '@/lib/tax/canada'")
  })

  it('an unrecognised id clears the choice rather than half-writing it', () => {
    expect(store).toContain("if (!picked) return { delivery_province: null, tax_kind: null, tax_label: null, tax_rate_percent: null }")
  })

  it('and the snapshot is written after the field map, so it wins', () => {
    const upd = store.slice(store.indexOf('export async function updateOrder'))
    expect(upd.indexOf('for (const [k, col] of Object.entries(map))')).toBeLessThan(upd.indexOf('const snap = taxSnapshotFrom(patch)'))
  })
})

describe('the document renders the snapshot', () => {
  it('the stored choice wins over any live lookup', () => {
    // One province can mean two correct rates, so a live lookup could not pick between them even if
    // rates never changed — and editing tax_rates must not alter a document already sent.
    expect(docData).toContain('const snapshot = taxFromSnapshot(')
    expect(docData).toContain('const tax = snapshot ?? taxOn(order.subtotalCents, rateFor(')
  })

  it('and the live lookup survives for orders raised before the picker', () => {
    // Nothing was backfilled, so those must render exactly as they did.
    expect(docData).toContain('rateFor(extra.deliveryProvince ?? null, rates)')
    expect(migration).toContain('NOTHING IS BACKFILLED, DELIBERATELY')
  })

  it('the place-of-supply rule is untouched', () => {
    // No destination, no tax line, never a 0% line.
    expect(docData).toContain('single most common Canadian tax error')
    // The sentence wraps in the source, so match the clause rather than the line.
    expect(body).toContain('line is a claim that no tax is due')
    expect(body).toContain('{tax && (')
  })
})

describe('the exemption is a claim, printed only when it is made', () => {
  it('the note renders ONLY when the box is ticked', () => {
    // A note left behind after unticking is not a claim, and printing it would put an exemption on a
    // document nobody stood behind.
    expect(docData).toContain('pstExemptionNote: extra.pstExempt ? (extra.pstExemptionNote?.trim() || null) : null')
  })

  it('and it prints beneath the tax line, in both copies', () => {
    const b = strip(body)
    expect(b.indexOf('{tax && (')).toBeLessThan(b.indexOf('{pstExemptionNote && ('))
    for (const p of ['../../app/orders/[id]/document/[type]/page.tsx', '../../app/e/[token]/page.tsx']) {
      expect(read(p), p).toContain('pstExemptionNote={data.pstExemptionNote}')
    }
  })

  it('off by default, at the database', () => {
    expect(migration).toContain('pst_exempt          boolean NOT NULL DEFAULT false')
  })

  it('nothing validates the claim, and nothing pretends to', () => {
    // Free text, no shape. The seller is the one who has to defend it.
    // (`certificateLab` in this same file is a GIA/IGI grading lab — an unrelated jewellery field, and
    //  the reason this asserts the note's own declaration rather than searching for the word.)
    expect(schema).toContain('pstExemptionNote: z.string().max(300).nullable().optional()')
    const note = schema.slice(schema.indexOf('pstExemptionNote:'))
    expect(note.slice(0, 120)).not.toMatch(/\.regex\(|\.refine\(|\.email\(/)
    expect(migration).toContain('a record of a claim, not a validated exemption')
  })
})

describe('the snapshot cannot be half-written', () => {
  it('the database refuses a label without a rate, or a rate without a label', () => {
    expect(migration).toContain('CHECK ((tax_label IS NULL) = (tax_rate_percent IS NULL))')
  })

  it('and tax_kind can only be the two readings', () => {
    expect(migration).toContain("CHECK (tax_kind IS NULL OR tax_kind IN ('gst_only', 'combined'))")
    // Not 'wholesale'/'retail' — those name a kind of CUSTOMER, which nothing here can support. The
    // migration's PROSE quotes both words to say so, hence stripping the comments before asserting.
    const sql = migration.replace(/^--.*$/gm, ' ')
    expect(sql).not.toMatch(/'wholesale'|'retail'/)
    expect(sql).toContain("'gst_only', 'combined'")
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { triage, expenseFromInvoice } from './door'
import type { ExtractedInvoice } from '@/lib/invoices/extract'

// THE ONE DOOR. See lib/invoices/OUTSTANDING.md §10 for the decision this pins.
//
// What is testable without a database is the part that decides — the triage, the mapping from an
// invoice read to an expense, and the RULES, which are assertions about source because they are
// rules about which of two code paths runs.

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const door = read('./door.ts')
const reclassify = read('./reclassify.ts')

const pdf = (pages: number) =>
  Buffer.from(`%PDF-1.4\n${'/Type /Page\n'.repeat(pages)}trailer\n`, 'latin1')

const invoice = (over: Partial<ExtractedInvoice> = {}): ExtractedInvoice => ({
  supplierName: 'PRIMAVERA FURNITURE SP. Z O.O.',
  invoiceNumber: '866/4/2026',
  invoiceDate: '2026-04-02',
  currency: 'EUR',
  subtotal: null,
  taxTotal: null,
  freightTotal: null,
  dutiesTotal: null,
  otherTotal: null,
  grandTotal: 37084,
  lines: [],
  ...over,
})

describe('the triage picks the DIALS, never the schema', () => {
  it('a photograph is a short read', () => {
    expect(triage(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg').long).toBe(false)
    expect(triage(Buffer.from([0x89, 0x50]), 'image/png').long).toBe(false)
  })

  it('a one-page PDF is a short read, and several pages is a long one', () => {
    expect(triage(pdf(1), 'application/pdf').long).toBe(false)
    expect(triage(pdf(15), 'application/pdf').long).toBe(true)
  })

  it('a PDF whose pages could not be counted is treated as LONG', () => {
    // The two errors are not symmetric. Guessing "short" puts a fifteen-page document on the
    // read-first path, where a failure leaves the person with nothing on screen at all; guessing
    // "long" costs a shipment row that a reclassify can move. Some PDFs genuinely shrug — pageCountOf
    // cannot see inside a compressed object stream, measured at 3 of 8 real files.
    expect(triage(Buffer.from('%PDF-1.7\nnothing countable\n', 'latin1'), 'application/pdf').long).toBe(true)
  })

  it('and the schema is chosen from the MODULE, which is a fact, not from any of this', () => {
    // Not run-both, not one-with-a-fallback. A one-page supplier invoice read against the receipt
    // schema comes back with a merchant and a total and silently drops every line.
    expect(door).toContain("enabledModulesOf(tenant).includes('landed_cost')")
    expect(door).toContain('if (!hasCatalogue) {')
    // The triage is consulted only AFTER the module has already chosen the reader.
    expect(door.indexOf('if (!hasCatalogue) {')).toBeLessThan(door.indexOf('const { long } = triage('))
  })
})

describe('an invoice read, as an expense', () => {
  const today = '2026-08-18'

  it('every field the form needs comes off the document', () => {
    const r = expenseFromInvoice(invoice(), today)
    expect(r.merchant).toBe('PRIMAVERA FURNITURE SP. Z O.O.')
    expect(r.amountCents).toBe(3708400)
    expect(r.spentOn).toBe('2026-04-02')
    expect(r.currency).toBe('EUR')
  })

  it('except the category, which is never guessed', () => {
    // It is an accounting judgement written nowhere on the paper, and it is the field the year-end
    // export groups by — so a guess is a wrong line in somebody's return, not a wrong pixel.
    expect(expenseFromInvoice(invoice(), today).category).toBeNull()
    expect(reclassify).toContain("return { ok: false, error: 'Pick a category for this expense.', status: 400 }")
  })

  it('a total that could not be read leaves the field EMPTY rather than zero', () => {
    // Zero means the document says zero. The form refuses it and the column is NOT NULL, so passing
    // it through would fill a field with something unsaveable.
    expect(expenseFromInvoice(invoice({ grandTotal: null }), today).amountCents).toBeNull()
    expect(expenseFromInvoice(invoice({ grandTotal: 0 }), today).amountCents).toBeNull()
    expect(expenseFromInvoice(invoice({ grandTotal: null }), today).readable).toBe('unreadable')
  })

  it('tax that is not smaller than the total is a misread, not a discovery', () => {
    expect(expenseFromInvoice(invoice({ grandTotal: 100, taxTotal: 120 }), today).taxCents).toBeNull()
    expect(expenseFromInvoice(invoice({ grandTotal: 100, taxTotal: 12 }), today).taxCents).toBe(1200)
  })

  it('a date in the future is left blank, on resolveSpentOn’s own rule', () => {
    // A receipt dated ahead of today is a misread year far more often than it is a real thing — and
    // this uses the SAME function the receipt reader does rather than a second opinion about dates.
    expect(expenseFromInvoice(invoice({ invoiceDate: '2027-01-01' }), today).spentOn).toBeNull()
    expect(door).toContain("import { readReceipt, resolveSpentOn, type ReceiptReading } from '@/lib/expenses/extract'")
  })

  it('a currency that is not three letters is nothing, never a slice of one', () => {
    expect(expenseFromInvoice(invoice({ currency: '' }), today).currency).toBeNull()
    expect(expenseFromInvoice(invoice({ currency: 'canadian dollars' }), today).currency).toBeNull()
  })
})

describe('where a document lands', () => {
  it('no catalogue module means an expense, with nothing asked', () => {
    expect(strip(door)).toContain('const r = await readReceipt(ctx.tenantId, bytes, mimeType, today)')
  })

  it('a document with no product lines on it is an expense, and is NOT asked about', () => {
    // The refinement of the rule as first written, and deliberate: it asked whenever nothing
    // MATCHED, which includes a petrol receipt. "Nothing matched" and "nothing to match" are
    // different facts, and asking "are these products you sell?" about a page with no products on it
    // is the kind of question this door exists to delete.
    expect(door).toContain('if (productLines.length === 0) {')
  })

  it('and the extraction the door paid for goes in with the bill rather than being run again', () => {
    expect(door).toContain('const r = await createShipmentFromFile(file, ex)')
    expect(read('../invoices/store.ts')).toContain('const ex = already ?? await extractInvoice(g.tenantId, bytes, mimeType, settings.baseCurrency)')
  })

  it('the long path writes its rows FIRST and the short path writes them last', () => {
    // Two opposite invariants for two different waits, and collapsing them into one rule breaks
    // whichever case it was not written for. Long: a failure leaves something on screen carrying the
    // reason. Short: a document that turns out to be an expense leaves no shipment behind.
    const longPath = door.indexOf('if (long) {')
    const shortPath = door.indexOf('const ex = await extractInvoice(')
    expect(longPath).toBeGreaterThan(-1)
    expect(longPath).toBeLessThan(shortPath)
    expect(door).toContain('const r = await createShipmentFromFile(file)')
  })
})

describe('a bill that was never stock', () => {
  it('moves without a second read, because nothing needs reading again', () => {
    // Supplier, number, date, currency and total were all extracted when it arrived.
    expect(strip(reclassify)).not.toMatch(/extractInvoice|readReceipt|readDocument/)
  })

  it('the file does not move — both tables are in one bucket', () => {
    expect(reclassify).toContain('receipt_path: stored?.storage_path ?? null')
  })

  it('the expense exists BEFORE the bill stops existing', () => {
    // The other order leaves a window where the money is recorded nowhere, and a failure in it loses
    // the document. This way the worst case is the same paper in both places — which is the state
    // the duplicate warning is for, rather than the state where it has vanished.
    expect(reclassify.indexOf("db.from('expenses').insert(")).toBeLessThan(
      reclassify.indexOf("db.from('landed_cost_shipments')\n    .delete()"))
  })

  it('and an APPLIED bill never moves, in the store as well as on the screen', () => {
    // Its costs are on the products, an expense row cannot carry them, and there is no un-apply.
    expect(reclassify).toContain("if (shipment.status === 'applied') {")
    expect(reclassify).toContain('It cannot be moved to Money out.')
    expect(strip(read('../../app/(v2)/v2/bills/[id]/page.tsx')))
      .toContain('These costs are on your products, so this bill can no longer be moved to Money out.')
  })

  it('one direction only — the expensive one is not hidden behind a flag on this', () => {
    // Expense → bill needs the document read a second time, because the expense path never
    // extracted the lines. When it is built it gets its own endpoint and its own cost.
    expect(read('../../app/api/money-out/reclassify/route.ts')).toContain('billToExpense')
    expect(strip(reclassify)).not.toContain('expenseToBill')
  })
})

describe('the duplicate backstop', () => {
  it('looks in BOTH tables, because one door only stops one of the two duplicates', () => {
    expect(door).toContain("db.from('expenses').select('id, merchant, spent_on')")
    expect(door).toContain("db.from('supplier_invoices').select('shipment_id, supplier_name, invoice_number')")
  })

  it('and warns rather than blocking', () => {
    // Re-uploading after a failed read is legitimate, and the owner knows which of the two they
    // meant — the rule findDuplicate already follows.
    expect(read('../../app/(v2)/v2/money-out/door.tsx')).toContain(', or carry on and keep both.')
    expect(read('../../supabase/migrations/add_expense_file_hash.sql')).toContain('NO UNIQUE CONSTRAINT')
  })

  it('the column is nullable and stays that way', () => {
    // Every expense typed by hand has no file at all. NOT NULL would mean inventing a value for
    // "there was no document", which is a fact rather than a missing one.
    const sql = read('../../supabase/migrations/add_expense_file_hash.sql')
    expect(sql).toContain('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS file_hash text;')
    expect(sql).not.toMatch(/file_hash text NOT NULL/)
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CATEGORIES, CATEGORY_KEYS, categoryByKey, categoryLabel } from './categories'
import { parseAmountCents, parseExpense, addDays } from './schema'
import { recoversTaxOnExpenses, isCanadianRegion } from './recoverable-tax'
import {
  fittedSize, receiptFileError, shouldDownscale, isReceiptImage,
  RECEIPT_MAX_BYTES, RECEIPT_LONG_EDGE, RECEIPT_STORED_TYPES, RECEIPT_EXTENSIONS,
} from './receipt'
import { jpegName } from './downscale'

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')

describe('the category list', () => {
  const migration = read('../../supabase/migrations/add_expenses.sql')

  // The keys the CHECK constraint actually admits. Sliced out rather than matched across the whole
  // file, because the migration's own commentary says the word 'other' several times explaining why
  // there isn't one — and an assertion that reads comments is an assertion about prose.
  const constrained = (() => {
    const from = migration.indexOf('expenses_category_check CHECK')
    const body = migration.slice(from, migration.indexOf('));', from))
    return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  })()

  it('is exactly what the database will accept', () => {
    // The constraint is the real gate; this list is what the UI offers. If they drift, a category a
    // person can pick is a row the insert refuses — and the failure surfaces at save time, after
    // they have typed everything.
    expect([...constrained].sort()).toEqual([...CATEGORY_KEYS].sort())
    expect(constrained.length).toBe(18)
  })

  it('has no "other", in the list or in the constraint', () => {
    // The whole argument for a fixed list. An 'other' bucket absorbs exactly the signal that the list
    // is incomplete, and turns it into rows nobody can file.
    for (const banned of ['other', 'misc', 'miscellaneous', 'uncategorised', 'uncategorized']) {
      expect(CATEGORY_KEYS).not.toContain(banned)
      expect(constrained).not.toContain(banned)
    }
  })

  it('gives every category a line on BOTH tax forms', () => {
    // Neither may be blank. A category with no home on one of the two forms is a row the accountant
    // in that country has to invent a place for, which is the work this list exists to remove.
    for (const c of CATEGORIES) {
      expect(c.scheduleC, c.key).toBeTruthy()
      expect(c.t2125, c.key).toBeTruthy()
    }
  })

  it('marks the two that are NOT expenses in Canada', () => {
    // materials and contract_labour file under cost of goods on T2125, not the expense part. An
    // export that listed them beside the others would be quietly wrong about the section.
    const cog = CATEGORIES.filter((c) => c.t2125Section === 'cost_of_goods').map((c) => c.key)
    expect(cog.sort()).toEqual(['contract_labour', 'materials'])
  })

  it('keeps wages and contract labour apart', () => {
    // The split that matters. The US treats them as different legal relationships (W-2 against 1099)
    // and misclassification carries penalties, so a single combined category would be cheap here and
    // expensive for the filer. Merging them must fail this test rather than pass review.
    expect(categoryByKey('wages')?.scheduleC).toMatch(/^26/)
    expect(categoryByKey('contract_labour')?.scheduleC).toMatch(/^11/)
  })

  it('never says "entertainment" beside meals on the US line', () => {
    // The US removed entertainment deductibility in 2018. A combined label invites a claim that gets
    // disallowed; Canada's own line name is allowed to say it because Canada's form does.
    expect(categoryByKey('meals')?.scheduleC).not.toMatch(/entertainment/i)
  })

  it('shows the key rather than a blank when the database holds something unknown', () => {
    expect(categoryLabel('vehicle_fuel')).toBe('Vehicle & fuel')
    expect(categoryLabel('something_new')).toBe('something_new')
  })
})

describe('reading an amount a person typed', () => {
  it('takes what people actually write', () => {
    expect(parseAmountCents('42.50')).toBe(4250)
    expect(parseAmountCents('$1,234.50')).toBe(123450)
    expect(parseAmountCents('  99 ')).toBe(9900)
    expect(parseAmountCents('0.05')).toBe(5)
    expect(parseAmountCents('7.5')).toBe(750)
  })

  it('refuses what cannot be read one way only', () => {
    // "1.234" is somebody who meant 1.23 or 1234 and there is no way to know which. Guessing puts a
    // wrong figure on a tax return that looks entirely ordinary.
    expect(parseAmountCents('1.234')).toBeNull()
    expect(parseAmountCents('')).toBeNull()
    expect(parseAmountCents('abc')).toBeNull()
    expect(parseAmountCents('-5')).toBeNull()
  })

  it('does not lose a cent to binary floating point', () => {
    // 19.99 * 100 is 1998.9999999999998. Rounding hides it until the day it does not.
    expect(parseAmountCents('19.99')).toBe(1999)
    expect(parseAmountCents('0.29')).toBe(29)
    expect(parseAmountCents('1.10')).toBe(110)
  })
})

describe('validating a submitted expense', () => {
  const good = { spentOn: '2026-08-01', merchant: 'Shell', amount: '61.20', category: 'vehicle_fuel' }
  const today = '2026-08-17'
  const ok = (r: Record<string, string | undefined>) => parseExpense(r, today)

  it('accepts a complete one', () => {
    const r = ok(good)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.amountCents).toBe(6120)
      expect(r.value.taxCents).toBeNull()
      expect(r.value.note).toBeNull()
    }
  })

  it('treats a blank tax as NOT SPLIT, never as zero', () => {
    // The distinction the column exists for. Blank means "the total, undivided" — every US row.
    // Zero would be a claim that the receipt carried no recoverable tax, which is a real and
    // different statement.
    const blank = ok({ ...good, tax: '' })
    expect(blank.ok && blank.value.taxCents).toBeNull()
    const zero = ok({ ...good, tax: '0' })
    expect(zero.ok && zero.value.taxCents).toBe(0)
  })

  it('refuses tax that is not smaller than the total', () => {
    // The same rule the database enforces, so it is caught in the sheet rather than as a 500.
    const r = ok({ ...good, amount: '10.00', tax: '10.00' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems[0].field).toBe('taxCents')
  })

  it('refuses a category that is not on the list', () => {
    const r = ok({ ...good, category: 'other' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems[0].field).toBe('category')
  })

  it('allows today and tomorrow, refuses next week', () => {
    // A day of tolerance because the tenant's today and the server's can differ across a timezone.
    // Refusing a receipt bought this evening would be the software wrong about the calendar.
    expect(ok({ ...good, spentOn: today }).ok).toBe(true)
    expect(ok({ ...good, spentOn: addDays(today, 1) }).ok).toBe(true)
    expect(ok({ ...good, spentOn: addDays(today, 7) }).ok).toBe(false)
  })

  it('reports every problem, not just the first', () => {
    // The sheet shows one message, but a form that reveals its faults one save at a time is a form
    // people abandon.
    const r = ok({ spentOn: 'nonsense', merchant: '', amount: 'x', category: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.length).toBe(4)
  })

  it('crosses midnight and month ends correctly', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('who sees a recoverable-tax field', () => {
  it('nobody, by default', () => {
    // The important direction. A false positive shows a US business a tax box, they type their sales
    // tax into it, and the export claims a credit that does not exist in their country.
    expect(recoversTaxOnExpenses({ state: null, hasCanadianOrder: false })).toBe(false)
    expect(recoversTaxOnExpenses({ state: 'NJ', hasCanadianOrder: false })).toBe(false)
    expect(recoversTaxOnExpenses({ state: 'New York', hasCanadianOrder: false })).toBe(false)
  })

  it('a Canadian province, however it was typed', () => {
    // The live value is 'bc', lowercase, on TG jewellers.
    expect(isCanadianRegion('bc')).toBe(true)
    expect(isCanadianRegion('BC ')).toBe(true)
    expect(isCanadianRegion('ON')).toBe(true)
    expect(isCanadianRegion('NY')).toBe(false)
  })

  it('or a business that has raised a Canadian order without ever filling in its address', () => {
    // 30 of 33 tenants have no state at all. The order signal is the one that catches a registrant
    // who has been charging GST for months.
    expect(recoversTaxOnExpenses({ state: null, hasCanadianOrder: true })).toBe(true)
  })

  it('and never from a timezone', () => {
    // TG jewellers reads state='bc' with timezone='America/New_York'. Inferring country from the
    // timezone would put the one Canadian tenant in the wrong country.
    expect(read('./recoverable-tax.ts')).not.toMatch(/timezone\s*[:.]/)
  })
})

describe('the receipt file', () => {
  it('is checked against the PLATFORM limit, not the bucket one', () => {
    // The bucket takes 20 MB; Vercel refuses a body over ~4.5 MB at the edge, before the route
    // exists. The smaller number is the real one.
    expect(RECEIPT_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024)
  })

  it('shrinks a phone photo and leaves a small one alone', () => {
    expect(shouldDownscale('IMG_4021.HEIC', 4.6 * 1024 * 1024)).toBe(true)
    expect(shouldDownscale('receipt.jpg', 120 * 1024)).toBe(false)
    // A PDF is never redrawn. There is no lossless way to shrink one here, and a silently
    // re-rendered document is not the document somebody was handed.
    expect(shouldDownscale('invoice.pdf', 9 * 1024 * 1024)).toBe(false)
    expect(isReceiptImage('invoice.pdf')).toBe(false)
  })

  it('never enlarges', () => {
    // Scaling a 900px receipt up to 2000px makes a bigger file carrying no more detail.
    expect(fittedSize(900, 600)).toEqual({ width: 900, height: 600 })
    expect(fittedSize(4032, 3024)).toEqual({ width: RECEIPT_LONG_EDGE, height: 1500 })
    expect(fittedSize(3024, 4032)).toEqual({ width: 1500, height: RECEIPT_LONG_EDGE })
    expect(fittedSize(0, 0)).toEqual({ width: 0, height: 0 })
  })

  it('renames a redrawn photo so the extension follows the bytes', () => {
    // The route reads the extension to pick a content type. A HEIC redrawn as JPEG but still called
    // .heic would be refused by the route's own check — the downscale rejecting its own output.
    expect(jpegName('IMG_4021.HEIC')).toBe('IMG_4021.jpg')
    expect(jpegName('receipt.png')).toBe('receipt.jpg')
    expect(jpegName('invoice.pdf')).toBe('invoice.pdf')
  })

  it('accepts HEIC at the picker but never stores it', () => {
    // Accepted because the redraw turns it into a JPEG; refused as a stored type because nothing that
    // would ever display it can read one.
    expect(RECEIPT_EXTENSIONS.heic).toBeTruthy()
    expect(RECEIPT_STORED_TYPES.has('image/heic')).toBe(false)
    expect(RECEIPT_STORED_TYPES.has('image/jpeg')).toBe(true)
  })

  it('says what is wrong in words the person can act on', () => {
    expect(receiptFileError('notes.txt', 1000)).toMatch(/photo .*or a PDF/i)
    expect(receiptFileError('big.pdf', 9 * 1024 * 1024)).toMatch(/photo of the receipt/i)
    expect(receiptFileError('huge.jpg', 9 * 1024 * 1024)).toMatch(/after shrinking/i)
    expect(receiptFileError('fine.jpg', 400 * 1024)).toBeNull()
  })
})

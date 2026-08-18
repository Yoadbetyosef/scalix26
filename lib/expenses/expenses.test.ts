import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CATEGORIES, CATEGORY_KEYS, categoryByKey, categoryLabel } from './categories'
import { parseAmountCents, parseExpense, addDays, expenseFieldsFrom } from './schema'
import { recoversTaxOnExpenses, isCanadianRegion } from './recoverable-tax'
import {
  fittedSize, receiptFileError, shouldDownscale, isReceiptImage, receiptChangeFrom,
  RECEIPT_MAX_BYTES, RECEIPT_LONG_EDGE, RECEIPT_STORED_TYPES, RECEIPT_EXTENSIONS,
} from './receipt'
import { jpegName } from './downscale'
import { resolveSpentOn, shapeReading } from './extract'

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

describe('deciding what happens to a receipt already on a row', () => {
  const photo = new File([new Uint8Array([1, 2, 3])], 'receipt.jpg', { type: 'image/jpeg' })

  it('keeps it when the form says nothing about it', () => {
    // Editing the merchant name posts no receipt and no action. The old photo must survive that.
    expect(receiptChangeFrom(undefined, null)).toEqual({ kind: 'keep' })
    expect(receiptChangeFrom(null, null)).toEqual({ kind: 'keep' })
    expect(receiptChangeFrom('keep', null)).toEqual({ kind: 'keep' })
  })

  it('removes it only when asked in so many words', () => {
    expect(receiptChangeFrom('remove', null)).toEqual({ kind: 'remove' })
  })

  it('replaces it when a file actually arrived', () => {
    expect(receiptChangeFrom('replace', photo)).toEqual({ kind: 'replace', file: photo })
  })

  // THE ONE THAT MATTERS. Every wrong answer in this function is destructive and none of them raise
  // an error, so the rule is: anything ambiguous keeps.
  it('keeps rather than deletes when the instruction cannot be honoured', () => {
    // 'replace' with no file — a client that lost the file between picking and sending. Reading this
    // as "clear it" would destroy proof on a request that was trying to add some.
    expect(receiptChangeFrom('replace', null)).toEqual({ kind: 'keep' })
    // An action word from a newer client than this server. Version skew, not permission to delete.
    expect(receiptChangeFrom('detach', null)).toEqual({ kind: 'keep' })
    expect(receiptChangeFrom('REMOVE', null)).toEqual({ kind: 'keep' })
    expect(receiptChangeFrom(1, null)).toEqual({ kind: 'keep' })
  })

  it('ignores a file that came with a remove', () => {
    // Contradictory, and the explicit word wins over the accidental attachment.
    expect(receiptChangeFrom('remove', photo)).toEqual({ kind: 'remove' })
  })
})

describe('the date off a receipt — blank asks, today asserts', () => {
  const today = '2026-08-18'

  it('takes what the receipt says, however old', () => {
    // The shoebox of eighteen-month-old receipts is the case this feature exists for. A rule against
    // old dates would refuse its own best use.
    expect(resolveSpentOn('2026-08-01', today)).toBe('2026-08-01')
    expect(resolveSpentOn('2025-01-14', today)).toBe('2025-01-14')
    expect(resolveSpentOn('2019-06-30', today)).toBe('2019-06-30')
  })

  it('allows tomorrow and refuses next week', () => {
    // The same one-day tolerance parseExpense has, for the same reason: the tenant's today and the
    // server's can legitimately differ by one across a timezone.
    expect(resolveSpentOn('2026-08-19', today)).toBe('2026-08-19')
    expect(resolveSpentOn('2026-08-20', today)).toBeNull()
    expect(resolveSpentOn('2027-08-18', today)).toBeNull()
  })

  it('refuses a date the calendar does not have', () => {
    // Date.parse accepts 2026-02-31 and quietly hands back 3 March. A silent three-day drift on a
    // date nobody was asked to confirm is exactly the bug this whole rule exists to prevent.
    expect(resolveSpentOn('2026-02-31', today)).toBeNull()
    expect(resolveSpentOn('2026-13-01', today)).toBeNull()
    expect(resolveSpentOn('2026-00-10', today)).toBeNull()
  })

  it('refuses anything that is not an ISO date, rather than interpreting it', () => {
    // "04/03/2026" is the ambiguous case the model is asked to resolve into spentOn. If it arrives
    // here unresolved, this must not pick an order — datePrinted is what the person reads instead.
    for (const junk of ['04/03/2026', '4 March 2026', '2026-8-1', 'yesterday', '', '   ']) {
      expect(resolveSpentOn(junk, today)).toBeNull()
    }
    expect(resolveSpentOn(null, today)).toBeNull()
  })
})

describe('shaping what came back from a receipt', () => {
  const today = '2026-08-18'
  const raw = (over: Partial<Parameters<typeof shapeReading>[0]> = {}) => shapeReading({
    readable: 'receipt', merchant: 'Shell', totalText: '42.50', taxText: null,
    datePrinted: '18/08/2026', spentOn: '2026-08-18', currency: 'usd', category: 'vehicle_fuel',
    ...over,
  }, today)

  it('turns printed text into cents through the one function that does that', () => {
    const r = raw()
    expect(r.amountCents).toBe(4250)
    expect(r.merchant).toBe('Shell')
    expect(r.spentOn).toBe('2026-08-18')
    expect(r.currency).toBe('USD')
    expect(r.category).toBe('vehicle_fuel')
  })

  // THE RULE THE WHOLE FEATURE RESTS ON. A blank asks the person a question; a wrong number gets
  // waved through, and an amount is the field they are least able to check from memory.
  it('never invents an amount', () => {
    expect(raw({ totalText: null }).amountCents).toBeNull()
    expect(raw({ totalText: 'illegible' }).amountCents).toBeNull()
    expect(raw({ totalText: '' }).amountCents).toBeNull()
    // Zero and negative are refused by the form and by the database. Offering either would fill the
    // field with something that cannot be saved.
    expect(raw({ totalText: '0' }).amountCents).toBeNull()
    expect(raw({ totalText: '0.00' }).amountCents).toBeNull()
    expect(raw({ totalText: '-12.00' }).amountCents).toBeNull()
    // Ambiguous to the cent — parseAmountCents already refuses this and it must not be rounded here.
    expect(raw({ totalText: '1.234' }).amountCents).toBeNull()
  })

  it('drops a tax it cannot stand behind rather than offering it', () => {
    expect(raw({ taxText: '5.10' }).taxCents).toBe(510)
    // Not smaller than the total is a misread, and parseExpense would refuse it at save time — so
    // offering it would put a value on screen that blocks the save the person is about to make.
    expect(raw({ totalText: '42.50', taxText: '42.50' }).taxCents).toBeNull()
    expect(raw({ totalText: '42.50', taxText: '99.00' }).taxCents).toBeNull()
    // No total to compare against: cannot be checked, so it is not offered.
    expect(raw({ totalText: null, taxText: '5.10' }).taxCents).toBeNull()
    expect(raw({ taxText: null }).taxCents).toBeNull()
  })

  it('refuses a category the database would refuse', () => {
    // The schema constrains this to the eighteen, but that constraint lives in a string the API
    // enforces. A category that got through anyway would fail the insert AFTER the person had
    // finished checking everything.
    expect(raw({ category: 'other' }).category).toBeNull()
    expect(raw({ category: 'petrol' }).category).toBeNull()
    expect(raw({ category: null }).category).toBeNull()
    expect(raw({ category: 'meals' }).category).toBe('meals')
  })

  it('keeps what it could read when the rest is missing', () => {
    // A partial read is the NORMAL case, not the sad path — merchant and total are usually legible
    // when the date has faded. Three fields and a null is the feature working.
    const r = raw({ spentOn: null, datePrinted: null, category: null, currency: null })
    expect(r.merchant).toBe('Shell')
    expect(r.amountCents).toBe(4250)
    expect(r.spentOn).toBeNull()
    expect(r.category).toBeNull()
  })

  it('carries the printed date through even when it could not be resolved', () => {
    // The one thing that lets a person catch a swapped day and month, so it must survive a spentOn
    // that was thrown away.
    const r = raw({ spentOn: '2026-02-31', datePrinted: '31/02/2026' })
    expect(r.spentOn).toBeNull()
    expect(r.datePrinted).toBe('31/02/2026')
  })

  it('passes on which kind of nothing it got', () => {
    // "I photographed my dog" and "the print has faded" need different sentences on screen.
    expect(raw({ readable: 'not_a_receipt' }).readable).toBe('not_a_receipt')
    expect(raw({ readable: 'unreadable' }).readable).toBe('unreadable')
  })

  it('bounds the strings it hands to a form', () => {
    expect(raw({ merchant: '  Shell  ' }).merchant).toBe('Shell')
    expect(raw({ merchant: '' }).merchant).toBeNull()
    expect(raw({ merchant: 'x'.repeat(400) }).merchant!.length).toBe(200)
  })

  it('takes an ISO currency code or nothing', () => {
    expect(raw({ currency: 'cad' }).currency).toBe('CAD')
    // Truncating to three characters would invent a currency that does not exist, arrived at by
    // string slicing — a value that looks deliberate to everything downstream.
    expect(raw({ currency: 'canadian dollars' }).currency).toBeNull()
    expect(raw({ currency: '$' }).currency).toBeNull()
    expect(raw({ currency: null }).currency).toBeNull()
  })
})

describe('lifting the fields off a submitted form', () => {
  it('reads all six and nothing else', () => {
    const f = new FormData()
    f.append('spentOn', '2026-08-01')
    f.append('merchant', 'Shell')
    f.append('amount', '42.50')
    f.append('tax', '5.10')
    f.append('category', 'vehicle_fuel')
    f.append('note', 'the van')
    f.append('tenantId', 'someone-elses')   // not a field, and must not become one
    expect(expenseFieldsFrom(f)).toEqual({
      spentOn: '2026-08-01', merchant: 'Shell', amount: '42.50',
      tax: '5.10', category: 'vehicle_fuel', note: 'the van',
    })
  })

  it('gives undefined for a field that was not sent, never the File beside it', () => {
    const f = new FormData()
    f.append('amount', '9.99')
    // A file posted under a text field's name must not be read as that field's value.
    f.append('merchant', new File([new Uint8Array([1])], 'x.jpg', { type: 'image/jpeg' }))
    const fields = expenseFieldsFrom(f)
    expect(fields.amount).toBe('9.99')
    expect(fields.merchant).toBeUndefined()
    expect(fields.category).toBeUndefined()
  })

  // The reason this function exists rather than six lines in each route: create and correct post the
  // identical form, and a field read in one and forgotten in the other stops being editable without
  // anything failing.
  it('covers every field parseExpense reads', () => {
    const f = new FormData()
    for (const k of ['spentOn', 'merchant', 'amount', 'tax', 'category', 'note']) f.append(k, 'x')
    expect(Object.values(expenseFieldsFrom(f)).every((v) => v === 'x')).toBe(true)
  })
})

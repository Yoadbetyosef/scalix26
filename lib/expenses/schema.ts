// WHAT A NEW EXPENSE MUST BE. Isomorphic — the sheet checks it before sending, the route enforces it.
//
// The form posts strings, because it posts multipart FormData with a file alongside. So the parsing
// lives here rather than in a zod coercion: a person types "$1,234.50" and means 123450 cents, and
// the place that decides so should be one function with tests rather than a regex in a component.

import { CATEGORY_KEYS } from './categories'

export interface ExpenseInput {
  spentOn: string
  merchant: string
  amountCents: number
  /** Recoverable tax inside amountCents. Null = not split — correct for every non-Canadian row. */
  taxCents: number | null
  category: string
  note: string | null
}

/** What went wrong, named by field so the sheet can point at it. */
export interface ExpenseProblem { field: keyof ExpenseInput | 'receipt'; message: string }

/**
 * "$1,234.50" → 123450. Null when it is not a number at all.
 *
 * Tolerant of what people actually type — a currency symbol, thousands separators, whitespace — and
 * intolerant of anything ambiguous. Two decimal places at most, because "1.234" is a person who meant
 * either 1.23 or 1234 and there is no way to know which.
 */
export function parseAmountCents(raw: string): number | null {
  const cleaned = raw.replace(/[\s$£€,]/g, '')
  if (!cleaned || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  // Split rather than multiply-and-round: 19.99 * 100 is 1998.9999999999998 in binary floating point,
  // and Math.round hides that until the day it does not.
  const [whole, frac = ''] = cleaned.split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'))
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate a submitted expense, returning either the row to write or every problem with it.
 *
 * `today` is passed in rather than read from the clock so the future-date rule is testable and so the
 * caller can supply the TENANT's today rather than the server's.
 */
export function parseExpense(
  raw: Record<string, string | undefined>,
  today: string,
): { ok: true; value: ExpenseInput } | { ok: false; problems: ExpenseProblem[] } {
  const problems: ExpenseProblem[] = []

  const spentOn = (raw.spentOn ?? '').trim()
  if (!ISO_DATE.test(spentOn) || Number.isNaN(Date.parse(`${spentOn}T00:00:00Z`))) {
    problems.push({ field: 'spentOn', message: 'Pick the date on the receipt.' })
  } else if (spentOn > addDays(today, 1)) {
    // A day of tolerance, not zero: the tenant's today and the server's can legitimately differ by
    // one across a timezone, and refusing a receipt bought this evening would be the software being
    // wrong about the calendar rather than the person being wrong about the date.
    problems.push({ field: 'spentOn', message: 'That date is in the future.' })
  }

  const merchant = (raw.merchant ?? '').trim()
  if (!merchant) problems.push({ field: 'merchant', message: 'Who was it paid to?' })
  else if (merchant.length > 200) problems.push({ field: 'merchant', message: 'That name is too long.' })

  const amountCents = parseAmountCents(raw.amount ?? '')
  if (amountCents === null) problems.push({ field: 'amountCents', message: 'Enter the amount, like 42.50.' })
  // Zero is refused at the database too. An expense of nothing is a row that adds nothing to a return
  // and subtracts from anyone's confidence in the rest of the list.
  else if (amountCents <= 0) problems.push({ field: 'amountCents', message: 'The amount has to be more than zero.' })

  // Blank is NOT zero. Blank means "not split", which is what every US row is; zero would be a claim
  // that the receipt carried no recoverable tax, which is a different statement.
  const taxRaw = (raw.tax ?? '').trim()
  let taxCents: number | null = null
  if (taxRaw) {
    taxCents = parseAmountCents(taxRaw)
    if (taxCents === null) problems.push({ field: 'taxCents', message: 'Enter the tax, like 5.60.' })
    else if (amountCents !== null && taxCents >= amountCents) {
      problems.push({ field: 'taxCents', message: 'The tax has to be less than the total.' })
    }
  }

  const category = (raw.category ?? '').trim()
  if (!category) problems.push({ field: 'category', message: 'Pick a category.' })
  else if (!CATEGORY_KEYS.includes(category)) {
    problems.push({ field: 'category', message: 'That is not one of the categories.' })
  }

  const noteRaw = (raw.note ?? '').trim()
  if (noteRaw.length > 1000) problems.push({ field: 'note', message: 'That note is too long.' })

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    value: { spentOn, merchant, amountCents: amountCents!, taxCents, category, note: noteRaw || null },
  }
}

/** ISO date arithmetic without a Date round trip losing a day to the local timezone. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

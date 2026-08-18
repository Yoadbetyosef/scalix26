import type { ExpenseList } from '@/lib/expenses/store'

// THE OPENING LINE ON /v2/expenses.
//
// Same rule as /v2/bills and /v2/invoices: say what is true, say nothing rather than pad a zero, and
// carry at most one accent — two accents is no accent.
//
// The subject here is not "how much have I spent", because a total with no period attached is a
// number nobody can act on. It is the RECEIPT COVERAGE: how many of these rows could be proved if
// somebody asked. That is the question an accountant actually puts at year end, and it is the only
// thing on this screen that gets worse if it is ignored.

export interface Segment { text: string; accent?: boolean }

const money = (cents: number, currency: string) => {
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : ''
  return `${sym}${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function expensesLine(list: Pick<ExpenseList, 'rows' | 'totalCents' | 'withReceipt' | 'currency'>): Segment[] {
  const n = list.rows.length
  if (n === 0) return [{ text: 'No expenses recorded yet.' }]

  const recorded = `${n} ${n === 1 ? 'expense' : 'expenses'}, ${money(list.totalCents, list.currency)}. `

  const missing = n - list.withReceipt
  if (missing > 0) {
    // Named as the thing that is absent, not as a percentage. "3 have no receipt" is something to go
    // and fix; "83% documented" is a score, and a score invites nothing.
    return [{ text: recorded }, { text: missing === 1 ? 'One has no receipt.' : `${missing} have no receipt.`, accent: true }]
  }

  return [{ text: recorded }, { text: n === 1 ? 'It has a receipt.' : 'Every one has a receipt.' }]
}

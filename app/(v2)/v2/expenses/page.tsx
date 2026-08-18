import Link from 'next/link'
import { readExpenses, type ExpenseRow } from '@/lib/expenses/store'
import { listPageContext } from '../list-page'
import { expensesLine } from './line'
import { MoneyOutDoor } from '../money-out/door'
import { Row } from './row'

// MONEY OUT — the door everything leaving comes in through, and the list of what did not become stock.
//
// Still the sibling of /v2/bills rather than a mode of it: a supplier bill has line items that become
// product costs, a coverage gate, an apply step and an allocation, and an expense is one amount and a
// category. Merging the two SCREENS would mean one screen with two modes, and the mode with two rows
// platform-wide would end up shaping the mode every tenant uses.
//
// What IS merged is the way in. The owner used to have to answer "is this an operating expense or is
// this cost of goods" before they knew what was in the document, in our vocabulary rather than
// theirs — and nothing stopped them answering it twice, once on each screen, which double-counts.
// Now there is one door and the document decides. See lib/money-out/door.tsx and OUTSTANDING.md §10.
//
// The heading says "Money out" for the same reason the rail row does: this page is both the door and
// one of the two things a document can land as, and naming it after the outcome is what sent people
// looking for a second upload.
//
// ── GROUPED BY MONTH, NOT BY CATEGORY ───────────────────────────────────────────────────────────
//
// Category is what the export groups by, because that is the accountant's question. The owner's
// question is "what did I spend last month", and it is asked far more often. Grouping by category
// here would answer neither well: twelve headings of one row each.
//
// ── AND THE ROW SAYS WHETHER IT CAN BE PROVED ───────────────────────────────────────────────────
//
// The receipt marker is the only status an expense has. It is also the one thing that gets worse if
// ignored — the amount is already recorded and will not change, but a receipt not photographed today
// is one nobody can produce in eighteen months.

export const dynamic = 'force-dynamic'

const money = (cents: number, currency: string) => {
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : ''
  return `${sym}${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const monthOf = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase()

export default async function V2Expenses() {
  // No module gate. Every business spends money, and `landed_cost` being off is exactly why a
  // locksmith's Money out reads $0 — putting this behind a second module would reproduce the fault it
  // exists to fix.
  await listPageContext()
  const list = await readExpenses()
  // Null means the store's own gate refused: no workspace, or a White Label operator who may not see
  // what the business pays for rent and payroll. An empty list would be the wrong thing to show for
  // it — it would read as "you have no expenses" rather than "this is not yours to see".
  if (!list) return <div className="v2-page"><p className="v2-bl-none">Those expenses could not be read.</p></div>

  const months = groupByMonth(list.rows)

  return (
    <div className="v2-page">
      <header className="v2-phd" data-inner>
        <div className="v2-phdin">
          <Link href="/v2" className="v2-bk" aria-label="Home">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
          </Link>
          <h2>Money out</h2>
          <div className="v2-hacts">
            <MoneyOutDoor showsTax={list.showsTax} />
          </div>
        </div>
      </header>

      <div className="v2-pbody" data-scroll>
        <div className="v2-ag-inner">
          {list.rows.length === 0 ? (
            <div className="v2-pempty">
              <p className="v2-pempty-t">No expenses recorded yet.</p>
              <p className="v2-pempty-b">
                Rent, fuel, insurance, software, a courier, a supplier — anything you spend. Photograph
                it or pick the file and it gets read; what is on it decides where it lands, and the
                paper is kept as proof for the day somebody asks.
              </p>
              <div className="v2-pempty-act"><MoneyOutDoor showsTax={list.showsTax} tone="empty" /></div>
            </div>
          ) : (
            <>
              <p className="v2-lin">
                {expensesLine(list).map((s, i) => (s.accent ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
              </p>
              {months.map(({ label, rows, total }) => (
                <div key={label}>
                  <p className="v2-ag-grp">
                    <span className="v2-ag-gt">{label}</span>
                    <span className="v2-ag-gn">{money(total, list.currency)}</span>
                    <span className="v2-ag-gr" />
                  </p>
                  <div className="v2-ag-card">
                    {rows.map((e, i) => (
                      <div key={e.id}>
                        {i > 0 && <div className="v2-ag-sep" />}
                        <Row e={e} showsTax={list.showsTax} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Newest month first, preserving the order the store already sorted rows into. */
function groupByMonth(rows: ExpenseRow[]): { label: string; rows: ExpenseRow[]; total: number }[] {
  const out: { label: string; rows: ExpenseRow[]; total: number }[] = []
  for (const r of rows) {
    const label = monthOf(r.spentOn)
    const last = out[out.length - 1]
    if (last && last.label === label) { last.rows.push(r); last.total += r.amountCents }
    else out.push({ label, rows: [r], total: r.amountCents })
  }
  return out
}

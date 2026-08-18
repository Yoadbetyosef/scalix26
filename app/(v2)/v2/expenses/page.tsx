import Link from 'next/link'
import { readExpenses, type ExpenseRow } from '@/lib/expenses/store'
import { categoryLabel } from '@/lib/expenses/categories'
import { listPageContext } from '../list-page'
import { expensesLine } from './line'
import { AddExpense } from './add'

// EXPENSES — money leaving that is not a supplier invoice.
//
// The sibling of /v2/bills, not a mode of it. A supplier bill has line items that become product
// costs, a coverage gate, an apply step and an allocation; an expense is one amount and a category.
// Merging them would mean one screen with two modes, and the mode with two rows platform-wide would
// end up shaping the mode every tenant uses.
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

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase()

const monthOf = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase()

function Row({ e, showsTax }: { e: ExpenseRow; showsTax: boolean }) {
  return (
    <div className="v2-xrw">
      <div className="v2-xmid">
        <div className="v2-xnm">{e.merchant}</div>
        <div className="v2-xmeta">
          {[
            categoryLabel(e.category),
            day(e.spentOn),
            e.note,
          ].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="v2-xamt">
        <div className="v2-xval">{money(e.amountCents, e.currency)}</div>
        {/* Only where it means something. A net figure on a US row would be the same number twice. */}
        {showsTax && e.taxCents !== null && (
          <div className="v2-xnet">{money(e.amountCents - e.taxCents, e.currency)} net</div>
        )}
      </div>
      {/* A link when there is one, a marker when there is not — same slot either way, so the column
          reads as a column rather than as ragged optional decoration. */}
      {e.hasReceipt ? (
        <a className="v2-xrec" href={`/api/expenses/${e.id}/receipt`} target="_blank" rel="noreferrer" aria-label={`Receipt for ${e.merchant}`}>
          <Paper />
        </a>
      ) : (
        <span className="v2-xrec" data-none aria-label="No receipt">—</span>
      )}
    </div>
  )
}

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
          <h2>Expenses</h2>
          <div className="v2-hacts">
            <AddExpense showsTax={list.showsTax} />
          </div>
        </div>
      </header>

      <div className="v2-pbody" data-scroll>
        <div className="v2-ag-inner">
          {list.rows.length === 0 ? (
            <div className="v2-pempty">
              <p className="v2-pempty-t">No expenses recorded yet.</p>
              <p className="v2-pempty-b">
                Rent, fuel, insurance, software, a courier — anything you spend that is not a supplier
                bill. Photograph the receipt and it is kept as proof for the day somebody asks.
              </p>
              <div className="v2-pempty-act"><AddExpense showsTax={list.showsTax} tone="empty" /></div>
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

const Paper = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 3v5h5" /><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2z" />
  </svg>
)

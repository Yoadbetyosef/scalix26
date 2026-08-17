import Link from 'next/link'
import { readBills, type BillRow } from '@/lib/invoices/bills-read'
import { listPageContext } from '../list-page'
import { billsLine } from './line'
import { coveragePct } from './groups'

// SUPPLIER BILLS — docs/miles/supplier-invoices.html.
//
// The other direction from /v2/invoices. That screen is money coming in and every figure on it was
// typed by the owner; this one is money going out and every figure was READ OFF A DOCUMENT by a model.
// That difference is the whole design: nothing here is presented as settled, and the number the screen
// leads with is not the total but how much of the document we could account for.
//
// ── COVERAGE IS THE HEADLINE ────────────────────────────────────────────────────────────────────
//
// €18,420 is not actionable. "74% matched" is: it says the bill cannot be applied yet, roughly how
// much work is left, and — the part that matters — that applying it anyway would push freight
// belonging to unidentified goods onto the products that WERE identified. The bar is amber below the
// gate and acid at or above it, so a bill that cannot be applied cannot look like one that can.

export const dynamic = 'force-dynamic'

const money = (n: number, cur: string) =>
  `${cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur === 'USD' ? '$' : ''}${Math.round(n).toLocaleString()}`
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase()

function Row({ b }: { b: BillRow }) {
  const pct = coveragePct(b.coverage.ratio)
  const done = b.status === 'applied'
  const quiet = b.status === 'reading' || b.status === 'failed'
  return (
    <Link
      href={`/v2/bills/${b.id}`}
      className="v2-bl-row"
      data-done={done || undefined}
      data-quiet={quiet || undefined}
    >
      <span className="v2-bl-bar" />
      <div className="v2-bl-mid">
        <div className="v2-bl-who">
          <div className="v2-bl-nm">{b.supplier}</div>
          <div className="v2-bl-meta">
            {[
              b.reference,
              `${b.lineCount} ${b.lineCount === 1 ? 'line' : 'lines'}`,
              done && b.appliedAt ? `applied ${day(b.appliedAt)}` : `received ${day(b.createdAt)}`,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        {/* No bar while it is still being read: a 0% bar on a document nobody has finished looking at
            is a claim about the matching rather than a report of it. */}
        {!quiet && (
          <div className="v2-bl-cov">
            <div className="v2-bl-covbar" data-low={b.belowGate || undefined}>
              <i style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            <div className="v2-bl-covlab">
              <span><b>{pct}%</b> matched{done ? '' : ' to products'}</span>
              <span>
                {done
                  ? `${b.productsCosted} ${b.productsCosted === 1 ? 'product' : 'products'} costed`
                  : `${b.coverage.unmatchedLines} unmatched`}
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="v2-bl-amt">
        <div className="v2-bl-val">{money(b.totalValue, b.currency)}</div>
        <div className="v2-bl-date">{b.currency}</div>
      </div>
    </Link>
  )
}

function Group({ label, rows }: { label: string; rows: BillRow[] }) {
  if (rows.length === 0) return null
  return (
    <>
      <p className="v2-ag-grp">
        <span className="v2-ag-gt">{label}</span>
        <span className="v2-ag-gn">{rows.length}</span>
        <span className="v2-ag-gr" />
      </p>
      <div className="v2-ag-card">
        {rows.map((b, i) => (
          <div key={b.id}>
            {i > 0 && <div className="v2-ag-sep" />}
            <Row b={b} />
          </div>
        ))}
      </div>
    </>
  )
}

export default async function V2Bills() {
  const { tenantId } = await listPageContext('landed_cost')
  const list = await readBills(tenantId)
  // readBills returns null only when the store's own gate refused — the module check above has
  // already passed, so this is a tenant/session mismatch rather than an empty list, and an empty
  // list would be the wrong thing to show for it.
  if (!list) return <div className="v2-page"><p className="v2-bl-none">Those bills could not be read.</p></div>

  return (
    <div className="v2-page">
      <header className="v2-phd" data-inner>
        <div className="v2-phdin">
          <Link href="/v2" className="v2-bk" aria-label="Home">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
          </Link>
          <h2>Supplier bills</h2>
        </div>
      </header>

      <div className="v2-pbody" data-scroll>
        <div className="v2-ag-inner">
          <p className="v2-lin">
            {billsLine(list).map((s, i) => (s.accent ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
          </p>

          {list.total === 0 ? (
            <div className="v2-pempty">
              <p className="v2-pempty-t">No supplier bills yet.</p>
              <p className="v2-pempty-b">
                Upload one and it gets read, matched to your products, and its freight and duty spread
                across them. Nothing is applied until you say so.
              </p>
            </div>
          ) : (
            <>
              {/* WAITING FIRST, always. The order is the order the work happens in, not newest-first:
                  an applied bill is finished and a list that leads with finished things is describing
                  itself rather than what is left to do. */}
              <Group label="WAITING ON YOU" rows={list.waiting} />
              <Group label="STILL BEING READ" rows={list.other} />
              <Group label="APPLIED" rows={list.applied} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

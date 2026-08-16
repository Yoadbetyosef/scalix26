import Link from 'next/link'
import { readInvoiceList } from '@/lib/core/invoice-read'
import { readInvoiceSettings } from '@/lib/core/invoice-settings'
import { listPageContext } from '../list-page'
import { invoicesLine } from './line'
import { PaymentDetails } from './settings'
import { NewInvoice } from './new'

// INVOICES — docs/miles/invoices-income.html, both widths, values taken directly.
//
// Not ListPage: the money band, the day-group form and a row that carries a progress bar are this
// screen's own, and forcing them through the shared list would mean a branch in it for one screen.
//
// READ-ONLY here. The one thing that writes is recording a payment, and that lives on the invoice
// itself — where the balance it changes is on the screen beside it.

export const dynamic = 'force-dynamic'

const dollars = (c: number) => `$${Math.round(c / 100).toLocaleString()}`
const exact = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default async function V2Invoices() {
  const { tenantId } = await listPageContext('invoices')
  const [list, settings] = await Promise.all([readInvoiceList(tenantId), readInvoiceSettings(tenantId)])

  const line = invoicesLine({
    outstandingCents: list.outstandingCents,
    outstandingCount: list.outstandingCount,
    draftCount: list.groups.find((g) => g.key === 'draft')?.rows.length ?? 0,
    paidCount: list.groups.find((g) => g.key === 'paid')?.rows.length ?? 0,
  })

  const empty = list.groups.length === 0

  return (
    <div className="v2-page">
      {/* The header aligns with the body's own column rather than with the window edge — the figures
          and the rows below it are a centred 820px, and a title floating 44px from the glass was the
          only thing on the screen that did not belong to that column. */}
      <header className="v2-phd" data-inner>
        <div className="v2-phdin">
          <Link href="/v2" className="v2-bk" aria-label="Home">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
          </Link>
          <h2>Invoices</h2>
          <div className="v2-hacts">
            {/* Typed once, and where the question occurs to somebody. */}
            <PaymentDetails instructions={settings.paymentInstructions} netDays={settings.netDays} />
            <NewInvoice />
          </div>
        </div>
      </header>

      {/* THE BAND. Sent this month, received this month, outstanding whenever it was issued — money
          owed does not stop being owed at a month boundary. */}
      {!empty && (
        <div className="v2-iv-band">
          <div className="v2-iv-bd">
            <p className="v2-iv-bdk">SENT</p>
            <p className="v2-iv-bdv">{dollars(list.sentCents)}</p>
            <p className="v2-iv-bds">{list.sentCount === 1 ? '1 invoice' : `${list.sentCount} invoices`} this month</p>
          </div>
          <div className="v2-iv-bd">
            <p className="v2-iv-bdk">RECEIVED</p>
            <p className="v2-iv-bdv">{dollars(list.receivedCents)}</p>
            <p className="v2-iv-bds">{list.receivedCount === 1 ? '1 payment' : `${list.receivedCount} payments`}</p>
          </div>
          <div className="v2-iv-bd">
            <p className="v2-iv-bdk">OUTSTANDING</p>
            <p className="v2-iv-bdv" data-tone={list.outstandingCents > 0 ? 'hold' : undefined}>{dollars(list.outstandingCents)}</p>
            <p className="v2-iv-bds">{list.outstandingCount === 1 ? '1 invoice' : `${list.outstandingCount} invoices`} waiting</p>
          </div>
          {/* Only when something IS overdue. A fourth cell reading $0 every day is a cell that stops
              being read, and then does not get read on the day it matters. */}
          {list.overdueCount > 0 && (
            <div className="v2-iv-bd">
              <p className="v2-iv-bdk">OVERDUE</p>
              <p className="v2-iv-bdv" data-tone="late">{dollars(list.overdueCents)}</p>
              <p className="v2-iv-bds">{list.overdueCount === 1 ? '1 invoice' : `${list.overdueCount} invoices`}</p>
            </div>
          )}
        </div>
      )}

      <div className="v2-pbody" data-scroll>
        <div className="v2-ag-inner">
          {empty ? (
            <div className="v2-pempty">
              <p className="v2-pempty-t">No invoices yet</p>
              <p className="v2-pempty-b">An invoice you raise will land here, with what has been paid against it.</p>
            </div>
          ) : (
            <>
              <p className="v2-ag-open">
                {line.map((s, i) => (s.accent ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
              </p>

              {list.groups.map((g) => (
                <div key={g.key}>
                  <p className="v2-ag-grp">
                    <span className="v2-ag-gt">{g.label}</span>
                    <span className="v2-ag-gn">{g.rows.length}</span>
                    <span className="v2-ag-gr" />
                  </p>
                  <div className="v2-ag-card">
                    {g.rows.map((r, i) => (
                      <div key={r.id}>
                        {i > 0 && <div className="v2-ag-sep" />}
                        <Link href={`/v2/invoices/${r.id}`} className="v2-iv-row" data-s={r.bucket === 'draft' ? 'draft' : r.status}>
                          {/* The spine IS the state: grey draft, violet issued, amber part paid, acid paid. */}
                          <span className="v2-iv-bar" />
                          <span className="v2-iv-mid">
                            <span className="v2-iv-nm">{r.who}</span>
                            <span className="v2-iv-sub">{r.sub}</span>
                            {/* Only when partly paid — a bar at 0 or 100 says nothing the figure does not. */}
                            {r.progress !== null && (
                              <span className="v2-iv-prog"><i style={{ width: `${Math.round(r.progress * 100)}%` }} /></span>
                            )}
                          </span>
                          <span className="v2-iv-amt">
                            <span className="v2-iv-av">{exact(r.bucket === 'paid' ? r.totalCents : r.outstandingCents)}</span>
                            {/* What the number means, in the fewest words that are true. A due date
                                only appears when one was agreed — an invoice with none says STILL
                                DUE, which is accurate, rather than a countdown to nothing. */}
                            <span className="v2-iv-ad" data-tone={r.bucket === 'overdue' ? 'late' : r.daysToDue !== null && r.daysToDue <= 7 ? 'due' : undefined}>
                              {r.bucket === 'draft' ? 'DRAFT'
                                : r.status === 'paid' ? 'PAID'
                                  : r.bucket === 'overdue' ? `${Math.abs(r.daysToDue ?? 0)} ${Math.abs(r.daysToDue ?? 0) === 1 ? 'DAY' : 'DAYS'} LATE`
                                    : r.status === 'partial' ? `${exact(r.paidCents)} OF ${exact(r.totalCents)}`
                                      : r.daysToDue !== null ? `DUE IN ${r.daysToDue} ${r.daysToDue === 1 ? 'DAY' : 'DAYS'}`
                                        : 'STILL DUE'}
                            </span>
                          </span>
                        </Link>
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

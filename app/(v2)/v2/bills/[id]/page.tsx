import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getShipment } from '@/lib/invoices/store'
import { coverage } from '@/lib/invoices/allocate'
import { MIN_COVERAGE } from '@/lib/invoices/types'
import { listPageContext } from '../../list-page'
import { groupLines, applyState, skippedCount, coveragePct } from '../groups'
import { Arrow, Warn } from '../glyphs'
import { ApplyBill } from './apply'
import { MatchLine } from './match'

// REVIEWING ONE BILL — docs/miles/supplier-invoices.html, stages 2 and 3.
//
// Everything here was read off a document by a model, and the screen never stops saying so. The four
// figures across the top are what the INVOICE STATES; matched % is the one the system computed, and it
// is the only one that can stop the apply.
//
// ── WAS → NOW IS THE POINT OF THE SCREEN ────────────────────────────────────────────────────────
//
// A cost going from €412 to €498 is a margin about to collapse, and it is the one thing a spreadsheet
// would never have told anybody. It is shown per line, before the apply, with the percentage beside
// it — red when the cost rises, acid when it falls. See lib/invoices/divergence.ts for what counts as
// "enough to matter" and why the flag's subject is the margin rather than the cost.

export const dynamic = 'force-dynamic'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const sym = (c: string) => (c === 'EUR' ? '€' : c === 'GBP' ? '£' : c === 'USD' ? '$' : '')
const money = (n: number, cur: string) => `${sym(cur)}${Math.round(n).toLocaleString()}`
const exact = (n: number, cur: string) => `${sym(cur)}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

export default async function V2Bill({ params }: { params: Promise<{ id: string }> }) {
  await listPageContext('landed_cost')
  const { id } = await params
  const res = await getShipment(id)
  if (!res.ok) notFound()

  const { shipment, invoice, lines, settings } = res.data
  const cov = coverage(lines)
  const groups = groupLines(lines)
  const skipped = skippedCount(lines)
  const cur = (invoice.currency || shipment.currency || 'usd').toUpperCase()
  const base = settings.baseCurrency.toUpperCase()
  const isForeign = cur !== base

  const state = applyState({
    ratio: cov.ratio,
    minCoverage: MIN_COVERAGE,
    matchedLines: cov.matchedLines,
    status: shipment.status,
    foreignWithoutRate: isForeign && !invoice.exchangeRate,
  })
  const pct = coveragePct(cov.ratio)
  const charges = shipment.freightTotal + shipment.dutiesTotal + shipment.otherTotal

  return (
    <div className="v2-page">
      <header className="v2-phd" data-inner>
        <div className="v2-phdin">
          <Link href="/v2/bills" className="v2-bk" aria-label="Supplier bills">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
          </Link>
          <h2>{invoice.invoiceNumber || 'Supplier bill'}</h2>
        </div>
      </header>

      <div className="v2-bl-top">
        <p className="v2-bl-sup">{invoice.supplierName || shipment.reference || invoice.fileName}</p>
        <p className="v2-bl-tmeta">
          {[
            invoice.invoiceNumber,
            invoice.invoiceDate ? day(`${invoice.invoiceDate}T12:00:00Z`) : `received ${day(shipment.createdAt)}`,
            cur,
            `${lines.length} lines`,
          ].filter(Boolean).map((t) => <span key={String(t)}>{t}</span>)}
        </p>
        {/* WHAT THE INVOICE STATES, and then the one figure the system worked out. Keeping them in one
            row is deliberate: the owner is checking the screen against a piece of paper, and the
            computed number belongs beside the stated ones so the odd one out is visible. */}
        <div className="v2-bl-tot">
          <div className="v2-bl-tt">
            <p className="v2-bl-ttk">GOODS</p>
            <p className="v2-bl-ttv">{money(invoice.grandTotal ?? cov.totalValue, cur)}</p>
          </div>
          <div className="v2-bl-tt">
            <p className="v2-bl-ttk">FREIGHT</p>
            <p className="v2-bl-ttv" data-small>{money(shipment.freightTotal, base)}</p>
          </div>
          <div className="v2-bl-tt">
            <p className="v2-bl-ttk">DUTIES</p>
            <p className="v2-bl-ttv" data-small>{money(shipment.dutiesTotal, base)}</p>
          </div>
          <div className="v2-bl-tt">
            <p className="v2-bl-ttk">MATCHED</p>
            <p className="v2-bl-ttv" data-small data-low={cov.ratio < MIN_COVERAGE || undefined}>{pct}%</p>
          </div>
        </div>
      </div>

      <div className="v2-pbody" data-scroll>
        <div className="v2-ag-inner">
          {/* The note says the CONSEQUENCE, not the count. "31 lines are unmatched" is a fact nobody
              can act on; "the 87 matched lines would carry all €2,240" is the reason to go and fix
              them. */}
          {cov.unmatchedLines > 0 && (
            <div className="v2-bl-note">
              <Warn />
              <span>
                <b>{cov.unmatchedLines} of {lines.length} lines aren&apos;t matched to a product.</b>{' '}
                Freight and duties can only be spread across what&apos;s matched, so the {cov.matchedLines} matched
                lines would carry all {money(charges, base)}.
              </span>
            </div>
          )}

          {isForeign && !invoice.exchangeRate && (
            <div className="v2-bl-note" data-red>
              <Warn />
              <span>
                <b>This invoice is in {cur} and your costs are in {base}.</b>{' '}
                Without the rate you actually paid, every cost this would write is wrong by that rate.
              </span>
            </div>
          )}

          {invoice.matchNote && (
            <div className="v2-bl-note">
              <Warn /><span>{invoice.matchNote}</span>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.key}>
              <p className="v2-ag-grp">
                <span className="v2-ag-gt">{g.label}</span>
                <span className="v2-ag-gn">{g.lines.length}</span>
                <span className="v2-ag-gr" />
              </p>
              <div className="v2-ag-card">
                {g.lines.map((l, i) => {
                  const d = l.divergence
                  return (
                    <div key={l.id}>
                      {i > 0 && <div className="v2-ag-sep" />}
                      <div className="v2-bl-line" data-warn={g.key === 'unmatched' || undefined} data-moved={g.key === 'moved' || undefined}>
                        <span className="v2-bl-lbar" />
                        <div className="v2-bl-lmid">
                          <p className="v2-bl-lsup">{l.description || l.sku || `Line ${l.lineNo}`}</p>
                          <p className="v2-bl-larrow">
                            {l.productId ? (
                              <>
                                <Arrow />
                                <span className="v2-bl-match">{l.productSku || l.productName || 'Matched'}</span>
                                {/* Two lines pointing at one product do not overwrite each other —
                                    they average, and an average appears on no piece of paper. */}
                                {(l.sharesProductWith ?? 0) > 0 && (
                                  <span className="v2-bl-lnone">shares this product with {l.sharesProductWith} more</span>
                                )}
                              </>
                            ) : (
                              <span className="v2-bl-lnone">No product matched</span>
                            )}
                          </p>
                          {d && (
                            <p className="v2-bl-lcost">
                              <span className="v2-bl-was">{exact(d.previousCost, base)}</span>
                              <span className="v2-bl-now">{exact(d.nextCost, base)}</span>
                              <span className="v2-bl-delta" data-ok={d.delta < 0 || undefined}>
                                {d.delta < 0 ? '−' : '+'}{Math.abs(Math.round(d.deltaRelative * 100))}%
                              </span>
                            </p>
                          )}
                          {/* An earlier applied shipment already put freight on this product, and an
                              apply REPLACES rather than adds. It does not block — reordering and
                              wanting the newer freight is the common, correct case. */}
                          {l.priorShipment && (
                            <p className="v2-bl-lcost">
                              <span className="v2-bl-lnone">
                                {l.priorShipment.reference || 'An earlier bill'} already put freight on this product
                              </span>
                            </p>
                          )}
                          {/* The only action that can move this bill above the coverage gate. Built
                              in /v2 rather than linked to /landed-cost — a row that leaves for the
                              old app is a dead end in one tap. */}
                          {g.key === 'unmatched' && (
                            <MatchLine lineId={l.id} description={l.description || l.sku || `Line ${l.lineNo}`} />
                          )}
                        </div>
                        <div className="v2-bl-lamt">
                          <p className="v2-bl-lv">{money(l.extended, cur)}</p>
                          {l.quantity !== null && <p className="v2-bl-lq">×{l.quantity}</p>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {skipped > 0 && (
            <p className="v2-bl-none">
              {skipped} {skipped === 1 ? 'line was' : 'lines were'} set aside. They take no freight and no duty.
            </p>
          )}
        </div>
      </div>

      <div className="v2-bl-slot">
        <div className="v2-bl-slotin">
          <p className="v2-bl-smsg">
            {state.reason === 'applied'
              ? <><b>Applied{shipment.appliedAt ? ` ${day(shipment.appliedAt)}` : ''}.</b> These costs are on your products.</>
              : state.reason === 'coverage'
                ? <><b>{pct}% matched.</b> {Math.round(MIN_COVERAGE * 100)}% is needed before costs can be applied.</>
                : state.reason === 'rate'
                  ? <><b>The exchange rate is missing.</b> Nothing can be applied until it is entered.</>
                  : state.reason === 'nothing'
                    ? <><b>Nothing is matched yet.</b> There is no product for these costs to land on.</>
                    : <><b>{pct}% matched.</b> This writes a cost onto {cov.matchedLines} {cov.matchedLines === 1 ? 'line' : 'lines'}.</>}
          </p>
          <ApplyBill
            shipmentId={shipment.id}
            canApply={state.can}
            matchedLines={cov.matchedLines}
            alreadyApplied={shipment.status === 'applied'}
          />
        </div>
      </div>
    </div>
  )
}

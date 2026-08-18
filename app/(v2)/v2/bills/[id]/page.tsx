import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getShipment } from '@/lib/invoices/store'
import { coverage } from '@/lib/invoices/allocate'
import { MIN_COVERAGE } from '@/lib/invoices/types'
import { listPageContext } from '../../list-page'
import { groupLines, applyState, overridable, skippedCount, coveragePct } from '../groups'
import { Arrow, Warn } from '../glyphs'
import { ApplyBill } from './apply'
import { CreateProducts } from './create'
import { BillCharge, BillRate } from './inputs'
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
  const { modules } = await listPageContext('landed_cost')
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

  const applied = shipment.status === 'applied'
  const charges = shipment.freightTotal + shipment.dutiesTotal + shipment.otherTotal

  const state = applyState({
    ratio: cov.ratio,
    minCoverage: MIN_COVERAGE,
    matchedLines: cov.matchedLines,
    status: shipment.status,
    foreignWithoutRate: isForeign && !invoice.exchangeRate,
    // Belt-and-braces, like v1's: the shipment's currency is always the tenant's base because freight
    // is never seeded from the document, so this should not fire. Kept because the RPC enforces the
    // same thing, and a screen that cannot show a state the database can refuse would leave the owner
    // reading an error with no matching field.
    freightNotInBase: charges > 0 && shipment.currency.toUpperCase() !== base,
    extractionFailed: invoice.status === 'failed',
  })
  const pct = coveragePct(cov.ratio)

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
          {/* ── TWO DOCUMENTS, KEPT VISIBLY APART, BECAUSE THEY ARE TWO DOCUMENTS ──────────────
              Left: the supplier's invoice and the rate paid on it. Right: the forwarder's bill.

              This is the most dangerous surface in the feature, because four different things meet
              on it: line values in the INVOICE's currency, a rate the owner types, freight and duty
              in BASE currency off a separate bill, and the result in base currency. So every figure
              carries its currency, always, even where it looks obvious — an unlabelled number
              between a EUR field and a USD field is exactly where a wrong one hides.

              The tiles in the header show the same two charges. They are the SUMMARY of what this
              screen holds and these are the fields that set it; they cannot disagree, because both
              are rendered from one server read. */}
          <section className="v2-bl-docs">
            <div className="v2-bl-doc">
              <p className="v2-bl-dock">{`Supplier invoice · ${cur}`}</p>
              {isForeign ? (
                <>
                  <BillRate
                    key={`rate-${invoice.exchangeRate ?? ''}`}
                    id={shipment.id} from={cur} to={base}
                    value={invoice.exchangeRate} disabled={applied}
                  />
                  <p className="v2-bl-docwhy">
                    {`The rate you actually paid on this invoice. It converts the line values below into ${base} — `}
                    {`and nothing else. Freight is never multiplied by it: that arrives from your forwarder already in ${base}.`}
                  </p>
                </>
              ) : (
                <p className="v2-bl-docwhy">{`Invoiced in ${base}, so nothing needs converting.`}</p>
              )}
              {invoice.grandTotal !== null && (
                <p className="v2-bl-docwhy">{`Invoice total ${exact(invoice.grandTotal, cur)}`}</p>
              )}
            </div>

            <div className="v2-bl-doc">
              <p className="v2-bl-dock">{`Freight forwarder · ${base}`}</p>
              <div className="v2-bl-chg">
                <BillCharge key={`freight-${shipment.freightTotal}`} label="Freight" value={shipment.freightTotal} id={shipment.id} field="freightTotal" ccy={base} disabled={applied} />
                <BillCharge key={`duties-${shipment.dutiesTotal}`} label="Duty" value={shipment.dutiesTotal} id={shipment.id} field="dutiesTotal" ccy={base} disabled={applied} />
                <BillCharge key={`other-${shipment.otherTotal}`} label="Other" value={shipment.otherTotal} id={shipment.id} field="otherTotal" ccy={base} disabled={applied} />
                <p className="v2-bl-spread">
                  <span>To spread</span>
                  <b>{exact(charges, base)}</b>
                </p>
              </div>
              {/* Evidence, not a value. Worth seeing beside the forwarder's figure because sometimes
                  it is the same shipment quoted twice — and worth NOT copying automatically, because
                  it is in the invoice's currency and these boxes are in base currency. */}
              {invoice.extractedFreight ? (
                <p className="v2-bl-docwhy">
                  {`The supplier's own invoice also lists ${exact(invoice.extractedFreight, cur)} of freight`}
                  {invoice.extractedDuties ? ` and ${exact(invoice.extractedDuties, cur)} of duty` : ''}
                  {`. Not copied above — these boxes are ${base}, from your forwarder. Check whether it is the same shipment billed twice.`}
                </p>
              ) : (
                <p className="v2-bl-docwhy">{`Type these from your forwarder's bill, in ${base}.`}</p>
              )}
            </div>
          </section>

          {invoice.status === 'failed' && (
            <div className="v2-bl-note" data-red>
              <Warn /><span>{invoice.extractionError || 'This invoice could not be read.'}</span>
            </div>
          )}

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
                Enter it above — until then these products would take the freight and end up with no
                landed cost at all.
              </span>
            </div>
          )}

          {state.reason === 'currency' && (
            <div className="v2-bl-note" data-red>
              <Warn />
              <span>
                <b>The freight on this bill is recorded in {shipment.currency.toUpperCase()}, and costs are kept in {base}.</b>{' '}
                Freight is never converted — it comes from the forwarder in {base}. Re-enter it above.
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
              {/* The other way past the gate, and on an empty catalogue the ONLY way: nothing can be
                  matched to products that do not exist yet. Gated on `inventory` as well as
                  `landed_cost`, because that is what the route requires — offering a button that comes
                  back "turn on the Inventory module" is a worse answer than not offering it. */}
              {g.key === 'unmatched' && !applied && modules.includes('inventory') && (
                <CreateProducts
                  lines={g.lines.map((l) => ({
                    id: l.id,
                    description: l.description,
                    sku: l.sku,
                    lineNo: l.lineNo,
                    // Formatted HERE so there is one money formatter on this screen rather than a
                    // second one inside a client component, in a different currency, on the same page.
                    amount: exact(l.extended, cur),
                    qty: l.quantity !== null ? `${l.quantity} ×` : null,
                  }))}
                />
              )}
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
                  : state.reason === 'currency'
                    ? <><b>The freight is in the wrong currency.</b> Nothing can be applied until it is re-entered.</>
                    : state.reason === 'failed'
                      ? <><b>This invoice could not be read.</b> There are no lines to spread anything across.</>
                      : state.reason === 'nothing'
                        ? <><b>Nothing is matched yet.</b> There is no product for these costs to land on.</>
                        : <><b>{pct}% matched.</b> This writes a cost onto {cov.matchedLines} {cov.matchedLines === 1 ? 'line' : 'lines'}.</>}
          </p>
          <ApplyBill
            shipmentId={shipment.id}
            canApply={state.can}
            canOverride={overridable(state.reason)}
            matchedLines={cov.matchedLines}
            unmatchedLines={cov.unmatchedLines}
            coveragePct={pct}
            alreadyApplied={applied}
            appliedAt={shipment.appliedAt}
          />
        </div>
      </div>
    </div>
  )
}

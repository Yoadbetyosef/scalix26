import Link from 'next/link'
import { notFound } from 'next/navigation'
import { readInvoice } from '@/lib/core/invoice-read'
import { readInvoiceSettings } from '@/lib/core/invoice-settings'
import { listPageContext } from '../../list-page'
import { MethodGlyph, METHOD_LABEL } from '../glyphs'
import { RecordPayment } from '../record'
import { IssueInvoice } from './issue'

// ONE INVOICE — docs/miles/invoices-income.html.
//
// The three figures at the top are DERIVED on read: total from the frozen header, received from the
// sum of allocations, still due from the difference. Nothing caches a balance, so nothing can
// disagree with the ledger it came from.

export const dynamic = 'force-dynamic'

const exact = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export default async function V2Invoice({ params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await listPageContext('invoices')
  const { id } = await params
  const inv = await readInvoice(tenantId, id)
  if (!inv) notFound()
  // A DRAFT has no snapshot yet, so it previews what it WOULD carry — which is the only moment the
  // owner can still change it. An issued invoice shows what it actually went out with, always.
  const settings = inv.row.bucket === 'draft' ? await readInvoiceSettings(tenantId) : null
  const payText = inv.paymentInstructions ?? settings?.paymentInstructions ?? null

  const r = inv.row
  const isDraft = r.bucket === 'draft'

  return (
    <div className="v2-page">
      <header className="v2-phd">
        <Link href="/v2/invoices" className="v2-bk" aria-label="Invoices">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
        </Link>
        <h2>{r.number}</h2>
      </header>

      <div className="v2-iv-dtop">
        <p className="v2-iv-dnum">{r.number}</p>
        <p className="v2-iv-dwho">{r.who}</p>
        <p className="v2-iv-dmeta">
          {isDraft ? `Not issued · created ${day(r.createdAt)}` : `Issued ${r.issuedAt ? day(r.issuedAt) : day(r.createdAt)}`}
          {r.dueOn ? ` · due ${day(`${r.dueOn}T12:00:00Z`)}` : ''}
          {inv.contact?.email ? ` · ${inv.contact.email}` : inv.contact?.phone ? ` · ${inv.contact.phone}` : ''}
        </p>
        <div className="v2-iv-dnums">
          <div className="v2-iv-dn"><p className="v2-iv-dnk">TOTAL</p><p className="v2-iv-dnv">{exact(r.totalCents)}</p></div>
          <div className="v2-iv-dn"><p className="v2-iv-dnk">RECEIVED</p><p className="v2-iv-dnv">{exact(r.paidCents)}</p></div>
          <div className="v2-iv-dn">
            <p className="v2-iv-dnk">STILL DUE</p>
            <p className="v2-iv-dnv" data-tone={r.outstandingCents > 0 ? 'hold' : undefined}>{exact(r.outstandingCents)}</p>
          </div>
          {/* Only when a date was agreed AND there is still something to pay. "Due in 11 days" over a
              paid invoice is a number about nothing. */}
          {r.daysToDue !== null && r.outstandingCents > 0 && (
            <div className="v2-iv-dn">
              <p className="v2-iv-dnk">{r.daysToDue < 0 ? 'LATE BY' : 'DUE IN'}</p>
              <p className="v2-iv-dnv" data-tone={r.daysToDue < 0 ? 'late' : undefined}>
                {Math.abs(r.daysToDue)} {Math.abs(r.daysToDue) === 1 ? 'day' : 'days'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="v2-pbody" data-scroll>
        <div className="v2-ag-inner">
          <p className="v2-ag-grp"><span className="v2-ag-gt">WHAT&apos;S ON IT</span><span className="v2-ag-gr" /></p>
          <div className="v2-ag-card">
            {inv.lines.length === 0 ? (
              <p className="v2-iv-none">Nothing on it yet. An invoice with no lines cannot be issued.</p>
            ) : (
              <>
                {inv.lines.map((l, i) => (
                  <div key={l.id}>
                    {i > 0 && <div className="v2-ag-sep" />}
                    <div className="v2-iv-li">
                      <span className="v2-iv-lin">{l.description}</span>
                      <span className="v2-iv-liq">×{l.quantity}</span>
                      <span className="v2-iv-liv">{exact(l.lineTotalCents)}</span>
                    </div>
                  </div>
                ))}
                <div className="v2-ag-sep" />
                <div className="v2-iv-tot"><span>Subtotal</span><span>{exact(inv.subtotalCents)}</span></div>
                {inv.discountCents > 0 && <div className="v2-iv-tot"><span>Discount</span><span>−{exact(inv.discountCents)}</span></div>}
                {inv.taxCents > 0 && <div className="v2-iv-tot"><span>Tax</span><span>{exact(inv.taxCents)}</span></div>}
                <div className="v2-iv-tot" data-big><span>Total</span><span>{exact(r.totalCents)}</span></div>
              </>
            )}
          </div>

          {inv.payments.length > 0 && (
            <>
              <p className="v2-ag-grp">
                <span className="v2-ag-gt">PAYMENTS</span>
                <span className="v2-ag-gn">{inv.payments.length}</span>
                <span className="v2-ag-gr" />
              </p>
              <div className="v2-ag-card">
                {inv.payments.map((p, i) => (
                  <div key={p.id}>
                    {i > 0 && <div className="v2-ag-sep" />}
                    <div className="v2-iv-prow">
                      <span className="v2-iv-pic"><MethodGlyph method={p.method} /></span>
                      <span className="v2-iv-pmid">
                        {/* A method nobody recorded says so. It is not 'Other' — that is a choice
                            somebody made, and this is its absence. */}
                        <span className="v2-iv-pm">{p.method ? METHOD_LABEL[p.method] ?? p.method : 'Method not recorded'}</span>
                        <span className="v2-iv-pd">
                          {day(p.at)}{p.ref ? ` · ref ${p.ref}` : ''}{p.kind !== 'charge' ? ` · ${p.kind}` : ''}
                        </span>
                      </span>
                      <span className="v2-iv-pv">{exact(p.amountCents)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* HOW THEY PAY YOU. Normal weight, not small print: this is the line the customer acts on,
              and setting it in grey 11px would be the screen deciding it is a legal footnote.
              A draft shows the tenant's CURRENT text as a preview; an issued invoice shows the
              snapshot it went out with, which never changes afterwards. */}
          {payText && (
            <>
              <p className="v2-ag-grp">
                <span className="v2-ag-gt">HOW THEY PAY YOU</span>
                {isDraft && <span className="v2-ag-gn">PREVIEW</span>}
                <span className="v2-ag-gr" />
              </p>
              <div className="v2-iv-pay">
                <p className="v2-iv-payt">{payText}</p>
                {isDraft && <p className="v2-iv-paynote">This is your current wording. The invoice keeps whatever it says when you issue it.</p>}
              </div>
            </>
          )}

          {inv.history.length > 0 && (
            <>
              <p className="v2-ag-grp"><span className="v2-ag-gt">HISTORY</span><span className="v2-ag-gr" /></p>
              <div className="v2-ag-card">
                {inv.history.map((h, i) => (
                  <div key={`${h.at}-${i}`}>
                    {i > 0 && <div className="v2-ag-sep" />}
                    <div className="v2-iv-prow" data-quiet data-note={h.note ? true : undefined}>
                      <span className="v2-iv-pmid">
                        {/* A note is the whole point of the row when there is one: it is how a create
                            that half-succeeded reaches an owner who closed the sheet. */}
                        <span className="v2-iv-pm">{h.note ?? (h.from ? `${h.from} → ${h.to}` : h.to)}</span>
                        <span className="v2-iv-pd">{day(h.at)}{h.note ? ` · ${h.to}` : ''}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* THE SLOT. One primary, and a sentence that says what is true rather than what to do. */}
      <div className="v2-iv-slot">
        <div className="v2-iv-slotin">
          {isDraft
            ? <IssueInvoice invoiceId={r.id} number={r.number} canIssue={inv.lines.length > 0} />
            : r.outstandingCents > 0
              ? <RecordPayment invoiceId={r.id} who={r.who} number={r.number} outstandingCents={r.outstandingCents} />
              : null}
          <p className="v2-iv-smsg">
            {isDraft
              ? <>Not issued yet. <b>Issuing fixes the total and the date.</b></>
              : r.outstandingCents > 0
                ? <><b>{exact(r.outstandingCents)} still due.</b> Nothing goes out automatically.</>
                : <><b>Paid in full.</b></>}
          </p>
        </div>
      </div>
    </div>
  )
}

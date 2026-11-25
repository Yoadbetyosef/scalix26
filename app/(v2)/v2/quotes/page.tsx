import Link from 'next/link'
import { readQuoteList, type QuoteListRow, type QuoteState } from '@/lib/core/quotes'
import { listPageContext } from '../list-page'
import { DeleteInvoice } from '../invoices/delete'
import { Plus } from '../invoices/glyphs'

// QUOTES — the Invoices screen's own form (band, opening line, groups, rows), about offers instead of
// money owed. Same classes on purpose: the two screens sit one above the other in the rail and should
// read as one idea at two stages.

export const dynamic = 'force-dynamic'

const dollars = (c: number) => `$${Math.round(c / 100).toLocaleString()}`
const exact = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const ago = (iso: string) => { const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago` }

const ORDER: QuoteState[] = ['waiting', 'draft', 'accepted', 'expired']
const LABEL: Record<QuoteState, string> = { waiting: 'WAITING FOR AN ANSWER', draft: 'DRAFTS', accepted: 'ACCEPTED', expired: 'EXPIRED' }
// The spine reuses the invoice row's four colours: grey draft, violet out with the customer, acid done, red late.
const SPINE: Record<QuoteState, string> = { draft: 'draft', waiting: 'unpaid', accepted: 'paid', expired: 'overdue' }

function sub(q: QuoteListRow): string {
  if (q.state === 'draft') return `Not sent · created ${ago(q.createdAt)}`
  if (q.state === 'accepted') return `${q.number} · accepted ${q.acceptedAt ? ago(q.acceptedAt) : ''}${q.invoiceId ? ' · invoice made' : ''}`
  const sent = q.sentAt ? `sent ${ago(q.sentAt)}${q.sentChannel ? ` by ${q.sentChannel === 'sms' ? 'SMS' : 'email'}` : ''}` : 'not sent'
  return q.state === 'expired' ? `${q.number} · ${sent}, never answered` : `${q.number} · ${sent}`
}
function tag(q: QuoteListRow): { text: string; tone?: 'due' | 'late' } {
  if (q.state === 'draft') return { text: 'DRAFT' }
  if (q.state === 'accepted') return { text: q.invoiceId ? 'INVOICED' : 'ACCEPTED' }
  if (q.state === 'expired') return { text: 'EXPIRED', tone: 'late' }
  if (q.daysLeft === null) return { text: 'NO END DATE' }
  if (q.daysLeft === 0) return { text: 'EXPIRES TODAY', tone: 'due' }
  return { text: `VALID ${q.daysLeft} MORE ${q.daysLeft === 1 ? 'DAY' : 'DAYS'}`, tone: q.daysLeft <= 7 ? 'due' : undefined }
}

export default async function V2Quotes() {
  const { tenantId } = await listPageContext('invoices')
  const list = await readQuoteList(tenantId)
  const by = (s: QuoteState) => list.filter((q) => q.state === s)
  const sum = (rows: QuoteListRow[]) => rows.reduce((n, q) => n + q.totalCents, 0)
  const waiting = by('waiting'), accepted = by('accepted'), drafts = by('draft')
  const soon = waiting.filter((q) => q.daysLeft !== null && q.daysLeft <= 7)
  const sent = list.filter((q) => q.state !== 'draft')

  return (
    <div className="v2-page">
      <header className="v2-phd" data-inner>
        <div className="v2-phdin">
          <Link href="/v2" className="v2-bk" aria-label="Home">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
          </Link>
          <h2>Quotes</h2>
          <div className="v2-hacts">
            <Link href="/v2/quotes/new" className="v2-hact" data-tone="primary" data-touch><Plus />New</Link>
          </div>
        </div>
      </header>

      {list.length > 0 && (
        <div className="v2-iv-band">
          <div className="v2-iv-bd">
            <p className="v2-iv-bdk">SENT</p>
            <p className="v2-iv-bdv">{dollars(sum(sent))}</p>
            <p className="v2-iv-bds">{sent.length === 1 ? '1 quote' : `${sent.length} quotes`}</p>
          </div>
          <div className="v2-iv-bd">
            <p className="v2-iv-bdk">ACCEPTED</p>
            <p className="v2-iv-bdv">{dollars(sum(accepted))}</p>
            <p className="v2-iv-bds">{accepted.length === 1 ? '1 quote' : `${accepted.length} quotes`}</p>
          </div>
          <div className="v2-iv-bd">
            <p className="v2-iv-bdk">WAITING FOR AN ANSWER</p>
            <p className="v2-iv-bdv" data-tone={waiting.length ? 'hold' : undefined}>{dollars(sum(waiting))}</p>
            <p className="v2-iv-bds">{waiting.length === 1 ? '1 quote' : `${waiting.length} quotes`}</p>
          </div>
          {soon.length > 0 && (
            <div className="v2-iv-bd">
              <p className="v2-iv-bdk">EXPIRING THIS WEEK</p>
              <p className="v2-iv-bdv" data-tone="late">{dollars(sum(soon))}</p>
              <p className="v2-iv-bds">{soon.length === 1 ? '1 quote' : `${soon.length} quotes`}</p>
            </div>
          )}
        </div>
      )}

      <div className="v2-pbody" data-scroll>
        <div className="v2-ag-inner">
          {list.length === 0 ? (
            <div className="v2-pempty">
              <p className="v2-pempty-t">No quotes yet</p>
              <p className="v2-pempty-b">A quote shows a customer what their order would cost, with a photo of every piece, and lets them accept it in one tap.</p>
            </div>
          ) : (
            <>
              <p className="v2-ag-open">
                {drafts.length > 0 && <span>{drafts.length === 1 ? '1 draft not sent. ' : `${drafts.length} drafts not sent. `}</span>}
                {waiting.length > 0
                  ? <b>{dollars(sum(waiting))} waiting on {waiting.length === 1 ? '1 customer' : `${waiting.length} quotes`}.</b>
                  : <span>Nothing is waiting on a customer.</span>}
              </p>
              {ORDER.filter((s) => by(s).length).map((s) => (
                <div key={s}>
                  <p className="v2-ag-grp">
                    <span className="v2-ag-gt">{LABEL[s]}</span>
                    <span className="v2-ag-gn">{by(s).length}</span>
                    <span className="v2-ag-gr" />
                  </p>
                  <div className="v2-ag-card">
                    {by(s).map((q, i) => {
                      const t = tag(q)
                      return (
                        <div key={q.id}>
                          {i > 0 && <div className="v2-ag-sep" />}
                          <div className="v2-iv-line">
                            <Link href={`/v2/quotes/${q.id}`} className="v2-iv-row" data-s={SPINE[q.state]}>
                              <span className="v2-iv-bar" />
                              {q.thumbs.length > 0 && (
                                <span className="v2-qt-thumbs">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  {q.thumbs.map((u) => <img key={u} src={u} alt="" loading="lazy" />)}
                                </span>
                              )}
                              <span className="v2-iv-mid">
                                <span className="v2-iv-nm">{q.who}</span>
                                <span className="v2-iv-sub">{sub(q)}</span>
                              </span>
                              <span className="v2-iv-amt">
                                <span className="v2-iv-av">{exact(q.totalCents)}</span>
                                <span className="v2-iv-ad" data-tone={t.tone}>{t.text}</span>
                              </span>
                            </Link>
                            {/* An accepted quote is what a customer agreed to, and stays. */}
                            {q.state !== 'accepted' && (
                              <DeleteInvoice id={q.id} noun="quote" endpoint={`/api/core/quotes/${q.id}`} label={q.state === 'draft' ? `the draft for ${q.who}` : `quote ${q.number}`} />
                            )}
                          </div>
                        </div>
                      )
                    })}
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

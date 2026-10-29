import type { ReactNode } from 'react'
import type { PublicInvoice } from '@/lib/core/invoice-read'

// THE CUSTOMER'S COPY — the paper itself, once.
//
// Rendered by /i/<token> for the customer and by the owner's Send sheet as the preview, so "what will
// they see?" is answered by the same markup the customer actually gets rather than a lookalike that
// can drift. Pure: no hooks, no fetching, safe on the server and inside a client sheet.
//
// ── THE LAYOUT IS AN ACCOUNTING INVOICE ─────────────────────────────────────────────────────────
//
// The shape a bookkeeper expects (QuickBooks-style): logo and business on top, INVOICE as the title,
// a strip with who it is billed to, the invoice facts and the balance due, a table with a dark header
// band, totals stacked on the right, then how to pay and the comments. Neutral ink, so any logo sits
// on it without clashing.

const money = (c: number, cur: string) =>
  `${cur === 'usd' ? '$' : ''}${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC' })

/** "Net 14" from the two dates issuing stamped — the terms are whatever was actually agreed. */
function terms(issuedAt: string | null, dueOn: string | null): string | null {
  if (!issuedAt || !dueOn) return null
  const days = Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${issuedAt.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
  return days <= 0 ? 'Due on receipt' : `Net ${days}`
}

export function InvoicePaper({ inv, children }: { inv: PublicInvoice; children?: ReactNode }) {
  const biz = inv.business
  const cityLine = [[biz.city, biz.state].filter(Boolean).join(', '), biz.zip].filter(Boolean).join(' ')
  const settled = inv.outstandingCents <= 0
  const t = terms(inv.issuedAt, inv.dueOn)
  const m = (c: number) => money(c, inv.currency)

  return (
    <div className="mx-auto max-w-3xl bg-white px-6 py-10 text-[#2b2b2b] sm:px-10 print:px-0 print:py-0">
      {/* ── HEAD ── */}
      <div className="flex flex-col-reverse gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="text-sm leading-relaxed text-neutral-600">
          <p className="text-[15px] font-semibold capitalize text-[#2b2b2b]">{biz.name || 'Invoice'}</p>
          {biz.address && <p>{biz.address}</p>}
          {cityLine && <p>{cityLine}</p>}
          {biz.phone && <p>{biz.phone}</p>}
          {biz.email && <p>{biz.email}</p>}
        </div>
        {inv.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={inv.logoUrl} alt={biz.name ?? ''} className="h-auto max-h-28 w-auto max-w-[300px] object-contain sm:ml-auto" />
        )}
      </div>

      <h1 className="mt-8 text-3xl font-light tracking-[0.2em] text-[#2b2b2b]">INVOICE</h1>

      {/* ── THE STRIP: billed to · the facts · balance due ── */}
      <div className="mt-6 grid gap-6 border-y border-neutral-200 py-5 text-sm sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Bill to</p>
          <p className="mt-1.5 font-medium capitalize">{inv.customerName || '—'}</p>
          {inv.customerEmail && <p className="text-neutral-600">{inv.customerEmail.toLowerCase()}</p>}
          {inv.customerPhone && <p className="text-neutral-600">{inv.customerPhone}</p>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 leading-5">Invoice no.</dt><dd className="text-right sm:text-left">{inv.number}</dd>
          {inv.issuedAt && <><dt className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 leading-5">Date</dt><dd className="text-right sm:text-left">{day(inv.issuedAt)}</dd></>}
          {inv.dueOn && <><dt className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 leading-5">Due date</dt><dd className="text-right sm:text-left">{day(`${inv.dueOn}T12:00:00Z`)}</dd></>}
          {t && <><dt className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 leading-5">Terms</dt><dd className="text-right sm:text-left">{t}</dd></>}
        </dl>
        <div className="sm:text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{settled ? 'Paid in full' : 'Balance due'}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{m(settled ? inv.totalCents : inv.outstandingCents)}</p>
          {inv.dueOn && !settled && <p className="mt-0.5 text-neutral-500">by {day(`${inv.dueOn}T12:00:00Z`)}</p>}
        </div>
      </div>

      {/* ── THE LINES ── */}
      <table className="mt-8 w-full text-sm">
        <thead>
          <tr className="bg-[#2b2b2b] text-left text-[11px] uppercase tracking-wider text-white print:bg-[#2b2b2b]" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
            <th className="px-3 py-2.5 font-semibold">Description</th>
            <th className="px-3 py-2.5 text-center font-semibold">Qty</th>
            <th className="px-3 py-2.5 text-right font-semibold">Rate</th>
            <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={l.id} className={`border-b border-neutral-200 align-top ${i % 2 ? 'bg-neutral-50' : ''}`} style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
              <td className="px-3 py-3 leading-snug">{l.description}</td>
              <td className="px-3 py-3 text-center tabular-nums">{l.quantity}</td>
              <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{m(l.unitPriceCents)}</td>
              <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{m(l.lineTotalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── TOTALS, stacked on the right ── */}
      <div className="mt-4 flex justify-end">
        <dl className="w-full max-w-xs text-sm">
          <div className="flex justify-between py-1.5"><dt className="text-neutral-600">Subtotal</dt><dd className="tabular-nums">{m(inv.subtotalCents)}</dd></div>
          {inv.discountCents > 0 && (
            <div className="flex justify-between py-1.5"><dt className="text-neutral-600">Discount</dt><dd className="tabular-nums">−{m(inv.discountCents)}</dd></div>
          )}
          {inv.taxCents > 0 && (
            <div className="flex justify-between py-1.5"><dt className="text-neutral-600">{inv.taxLabel}</dt><dd className="tabular-nums">{m(inv.taxCents)}</dd></div>
          )}
          <div className="mt-1 flex justify-between border-t border-neutral-300 py-2 font-semibold"><dt>Total</dt><dd className="tabular-nums">{m(inv.totalCents)}</dd></div>
          {inv.paidCents > 0 && (
            <div className="flex justify-between py-1.5 text-neutral-600"><dt>Payments received</dt><dd className="tabular-nums">−{m(inv.paidCents)}</dd></div>
          )}
          <div className="mt-1 flex justify-between border-t-2 border-[#2b2b2b] pt-2.5 text-base font-semibold">
            <dt>Balance due</dt><dd className="tabular-nums">{m(Math.max(0, inv.outstandingCents))}</dd>
          </div>
        </dl>
      </div>

      {/* ── HOW TO PAY ── NORMAL WEIGHT: this is the line they act on. `whitespace-pre-line` because
          bank details are a shape as much as a string — a routing number reflowed is unreadable. */}
      {inv.paymentInstructions && !settled && (
        <div className="mt-10 rounded-lg border border-neutral-200 bg-neutral-50 p-5" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">How to pay</p>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-neutral-800">{inv.paymentInstructions}</p>
        </div>
      )}

      {inv.notes && (
        <div className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Comments</p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-neutral-700">{inv.notes}</p>
        </div>
      )}

      <p className="mt-12 text-center text-xs text-neutral-400">Thank you for your business.</p>

      {children}
    </div>
  )
}

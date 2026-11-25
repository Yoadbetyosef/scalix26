import type { ReactNode } from 'react'
import type { PublicQuote } from '@/lib/core/quotes'

// THE CUSTOMER'S COPY OF A QUOTE. The invoice paper's own head and strip (components/invoices/
// invoice-paper.tsx) so a customer who gets both sees one business — and then the thing a quote is
// for: every piece shown with its picture, large, the way it would be shown in the showroom.

const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-neutral-500'

export function QuotePaper({ q, children }: { q: PublicQuote; children?: ReactNode }) {
  const biz = q.business
  const cityLine = [[biz.city, biz.state].filter(Boolean).join(', '), biz.zip].filter(Boolean).join(' ')
  return (
    <div className="mx-auto max-w-3xl bg-white px-6 py-10 text-[#2b2b2b] sm:px-10 print:max-w-none print:px-0 print:py-0">
      <div className="flex flex-col-reverse gap-6 sm:flex-row sm:items-start sm:justify-between print:flex-row print:items-start print:justify-between">
        <div className="text-sm leading-relaxed text-neutral-600">
          <p className="text-[15px] font-semibold capitalize text-[#2b2b2b]">{biz.name || 'Quote'}</p>
          {biz.address && <p>{biz.address}</p>}
          {cityLine && <p>{cityLine}</p>}
          {biz.phone && <p>{biz.phone}</p>}
          {biz.email && <p>{biz.email}</p>}
        </div>
        {q.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.logoUrl} alt={biz.name ?? ''} className="h-auto max-h-28 w-auto max-w-[300px] object-contain sm:ml-auto print:ml-auto print:max-h-24" />
        )}
      </div>

      <h1 className="mt-8 text-3xl font-light tracking-[0.2em] text-[#2b2b2b] print:mt-6">QUOTE</h1>

      <div className="mt-6 grid gap-6 border-y border-neutral-200 py-5 text-sm sm:grid-cols-3 print:grid-cols-[1fr_auto_1fr] print:gap-8">
        <div>
          <p className={LABEL}>Prepared for</p>
          <p className="mt-1.5 font-medium capitalize">{q.contact?.name || '—'}</p>
          {q.contact?.email && <p className="text-neutral-600">{q.contact.email.toLowerCase()}</p>}
          {q.contact?.phone && <p className="text-neutral-600">{q.contact.phone}</p>}
          {q.clientName && <><p className={`${LABEL} mt-3`}>Client</p><p className="mt-1 font-medium capitalize">{q.clientName}</p></>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className={`${LABEL} whitespace-nowrap leading-5`}>Quote no.</dt><dd>{q.number}</dd>
          <dt className={`${LABEL} whitespace-nowrap leading-5`}>Date</dt><dd>{day(q.sentAt ?? q.createdAt)}</dd>
          {q.validUntil && <><dt className={`${LABEL} whitespace-nowrap leading-5`}>Valid until</dt><dd>{day(`${q.validUntil}T12:00:00Z`)}</dd></>}
        </dl>
        <div className="sm:text-right print:text-right">
          <p className={LABEL}>Total</p>
          <p className="mt-1 whitespace-nowrap text-3xl font-semibold tabular-nums print:text-2xl">{money(q.totalCents)}</p>
        </div>
      </div>

      <div>
        {q.lines.map((l) => (
          <div key={l.id} className="grid grid-cols-[96px_1fr] items-center gap-x-5 gap-y-2 border-b border-neutral-200 py-6 sm:grid-cols-[150px_1fr_auto] sm:gap-x-6 print:grid-cols-[110px_1fr_auto] print:break-inside-avoid print:py-4">
            {l.imageUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={l.imageUrl} alt="" className="h-24 w-24 rounded-[3px] bg-neutral-100 object-cover sm:h-[150px] sm:w-[150px] print:h-[110px] print:w-[110px]" />
              : <div className="h-24 w-24 rounded-[3px] bg-neutral-100 sm:h-[150px] sm:w-[150px] print:h-[110px] print:w-[110px]" />}
            <div className="min-w-0">
              <p className="text-base font-medium tracking-wide">{l.name}</p>
              {l.detail && <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-600">{l.detail}</p>}
              <p className="mt-2.5 text-[11px] uppercase tracking-[0.12em] text-neutral-400">Qty {l.quantity} · {money(l.unitPriceCents)} each</p>
            </div>
            <p className="col-start-2 text-base font-medium tabular-nums sm:col-start-3 sm:text-right print:col-start-3 print:text-right">{money(l.lineTotalCents)}</p>
          </div>
        ))}
      </div>

      <div className="ml-auto mt-5 w-full max-w-xs text-sm">
        <div className="flex justify-between py-2 text-neutral-600"><span>Subtotal</span><span className="tabular-nums">{money(q.subtotalCents)}</span></div>
        {q.discountCents > 0 && <div className="flex justify-between py-2 text-neutral-600"><span>{q.discountLabel}</span><span className="tabular-nums">−{money(q.discountCents)}</span></div>}
        <div className="mt-1 flex justify-between border-t-2 border-[#2b2b2b] pt-3 text-[17px] font-semibold"><span>Total</span><span className="tabular-nums">{money(q.totalCents)}</span></div>
      </div>

      {q.notes && <p className="mt-8 whitespace-pre-wrap rounded-md border border-neutral-200 px-5 py-4 text-[13px] leading-relaxed text-neutral-700 print:break-inside-avoid">{q.notes}</p>}

      {children}
    </div>
  )
}

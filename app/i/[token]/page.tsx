import { notFound } from 'next/navigation'
import { readPublicInvoice } from '@/lib/core/invoice-read'
import { PrintButton } from '@/components/studio/print-button'

// THE CUSTOMER'S COPY OF AN INVOICE.
//
// No session. The token in the URL is the sole credential — the same arrangement /d/ uses for studio
// documents and /e/ for order documents. It is a THIRD path deliberately: /d/ resolves against
// studio_documents, four of which have been sent to a real customer, and a token URL given to a
// customer is a promise. The cheapest way to keep it is not to go near it.
//
// ── PAYMENT INSTRUCTIONS COME FIRST ─────────────────────────────────────────────────────────────
//
// Above the lines, not below them. On the owner's screen the block is reference material; on this one
// it is the INSTRUCTION, and an instruction goes before the detail it applies to. It renders the
// SNAPSHOT taken at issue, so somebody reopening a six-month-old link sees where the money was meant
// to go then — not wherever the business banks today.
//
// It is also the answer to the placeholder /d/ still shows on a studio invoice: "Payment instructions
// to be provided by the studio."

export const dynamic = 'force-dynamic'

// The page title is the TENANT'S, and only the tenant's. Chrome prints document.title at the top of
// every printed page, so inheriting the root layout's platform name would put our brand across the
// top of every invoice a customer prints. A customer reading this is not our customer.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  try {
    const inv = await readPublicInvoice((await params).token)
    if (!inv) return { title: '' }
    return {
      title: [inv.business.name, `Invoice ${inv.number}`].filter(Boolean).join(' · '),
      robots: { index: false, follow: false },
    }
  } catch {
    return { title: '' }
  }
}

const money = (c: number, cur: string) =>
  `${cur === 'usd' ? '$' : ''}${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const inv = await readPublicInvoice(token)
  // A draft answers the same way a bad token does — see readPublicInvoice.
  if (!inv) notFound()

  const biz = inv.business
  const addr = [biz.address, [biz.city, biz.state, biz.zip].filter(Boolean).join(', ')].filter(Boolean)
  const settled = inv.outstandingCents <= 0

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-white px-6 py-10 text-neutral-900 print:py-4">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold">{biz.name || 'Invoice'}</p>
          {addr.map((l) => <p key={l} className="text-sm text-neutral-500">{l}</p>)}
          {biz.email && <p className="text-sm text-neutral-500">{biz.email}</p>}
          {biz.phone && <p className="text-sm text-neutral-500">{biz.phone}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Invoice</p>
          <p className="text-lg font-semibold">{inv.number}</p>
          {inv.issuedAt && <p className="mt-1 text-sm text-neutral-500">Issued {day(inv.issuedAt)}</p>}
          {inv.dueOn && <p className="text-sm text-neutral-500">Due {day(`${inv.dueOn}T12:00:00Z`)}</p>}
        </div>
      </div>

      {inv.customerName && (
        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Billed to</p>
          <p className="mt-1 text-base">{inv.customerName}</p>
        </div>
      )}

      {/* ── WHAT THEY OWE, AND HOW TO PAY IT — before the detail, because this is the instruction ── */}
      <div className="mb-8 rounded-xl border border-neutral-200 p-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            {settled ? 'Paid in full' : inv.paidCents > 0 ? 'Still to pay' : 'Amount due'}
          </p>
          <p className="text-2xl font-semibold tabular-nums">{money(settled ? inv.totalCents : inv.outstandingCents, inv.currency)}</p>
        </div>
        {/* Only when something HAS been paid. "$0.00 received" on a fresh invoice is noise. */}
        {inv.paidCents > 0 && !settled && (
          <p className="mt-1 text-right text-sm text-neutral-500">
            {money(inv.paidCents, inv.currency)} of {money(inv.totalCents, inv.currency)} received
          </p>
        )}
        {inv.paymentInstructions && !settled && (
          <div className="mt-4 border-t border-neutral-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">How to pay</p>
            {/* NORMAL WEIGHT. This is the line they act on — 11px grey would be the page deciding it is
                a footnote. `whitespace-pre-line` because bank details are a shape as much as a string:
                a routing number reflowed onto the previous line is unreadable. */}
            <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-neutral-800">{inv.paymentInstructions}</p>
          </div>
        )}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-400">
            <th className="pb-2 font-medium">Description</th>
            <th className="pb-2 text-center font-medium">Qty</th>
            <th className="pb-2 text-right font-medium">Unit</th>
            <th className="pb-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {inv.lines.map((l) => (
            <tr key={l.id}>
              <td className="py-2.5">{l.description}</td>
              <td className="py-2.5 text-center tabular-nums">{l.quantity}</td>
              <td className="py-2.5 text-right tabular-nums">{money(l.unitPriceCents, inv.currency)}</td>
              <td className="py-2.5 text-right tabular-nums">{money(l.lineTotalCents, inv.currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {inv.discountCents > 0 && (
            <tr><td colSpan={3} className="py-2 text-right text-neutral-500">Discount</td>
              <td className="py-2 text-right tabular-nums">−{money(inv.discountCents, inv.currency)}</td></tr>
          )}
          {inv.taxCents > 0 && (
            <tr><td colSpan={3} className="py-2 text-right text-neutral-500">Tax</td>
              <td className="py-2 text-right tabular-nums">{money(inv.taxCents, inv.currency)}</td></tr>
          )}
          <tr className="border-t border-neutral-200">
            <td colSpan={3} className="py-3 text-right font-medium">Total</td>
            <td className="py-3 text-right text-lg font-semibold tabular-nums">{money(inv.totalCents, inv.currency)}</td>
          </tr>
          {inv.paidCents > 0 && (
            <>
              <tr><td colSpan={3} className="py-1 text-right text-neutral-500">Received</td>
                <td className="py-1 text-right tabular-nums text-neutral-500">−{money(inv.paidCents, inv.currency)}</td></tr>
              <tr><td colSpan={3} className="py-1 text-right font-medium">{settled ? 'Balance' : 'Still to pay'}</td>
                <td className="py-1 text-right font-semibold tabular-nums">{money(inv.outstandingCents, inv.currency)}</td></tr>
            </>
          )}
        </tfoot>
      </table>

      {inv.notes && (
        <div className="mt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Notes</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{inv.notes}</p>
        </div>
      )}

      <div className="mt-10 print:hidden"><PrintButton /></div>
    </main>
  )
}

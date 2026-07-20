import { notFound } from 'next/navigation'
import { resolvePublicProposal } from '@/lib/core/proposals'
import { looksLikeToken } from '@/lib/core/proposal-token'
import { ProposalPublicActions } from '@/components/commerce/proposal-public-actions'

// PUBLIC customer-facing proposal page. No auth — the token in the URL is the sole credential (hashed +
// validated server-side, revocable). Records a view on render. Shows only customer-safe data (never cost).
export const dynamic = 'force-dynamic'

const fmt = (cents: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'usd' }).format(cents / 100)

export default async function PublicProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!looksLikeToken(token)) notFound()
  const p = await resolvePublicProposal(token, { recordView: true })
  if (!p) notFound()
  const done = p.status === 'accepted' || p.status === 'declined' || p.status === 'converted'

  return (
    <main className="min-h-screen bg-[#f6f7f9] px-4 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-2xl">
        <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-sm print:border-0 print:shadow-none">
          {/* Branded header */}
          <div className="border-b border-[#e5e7eb] px-6 py-5">
            <div className="text-sm font-semibold text-[#374151]">{p.businessName}</div>
            <div className="mt-1 flex items-baseline justify-between">
              <h1 className="text-xl font-light text-[#111827]">Proposal {p.number}</h1>
              <StatusPill status={p.status} />
            </div>
            {p.customerName && <p className="mt-1 text-sm text-[#6b7280]">Prepared for {p.customerName}</p>}
            {p.expires_at && <p className="mt-0.5 text-xs text-[#9ca3af]">Valid until {String(p.expires_at).slice(0, 10)}</p>}
          </div>

          {p.is_expired && <div className="bg-red-50 px-6 py-2 text-sm text-red-700">This proposal has expired. Please contact {p.businessName} for an updated version.</div>}

          {/* Line items */}
          <div className="divide-y divide-[#f0f1f3]">
            {p.lines.map((l, i) => (
              <div key={i} className="flex gap-4 px-6 py-4">
                {l.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={l.image_url} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-[#e5e7eb] object-cover" />
                  : <div className="h-16 w-16 shrink-0 rounded-lg bg-[#f3f4f6]" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[#111827]">{l.description || 'Item'}</p>
                  {l.sku && <p className="text-xs text-[#9ca3af]">SKU {l.sku}</p>}
                  {Object.keys(l.attributes || {}).length > 0 && <p className="mt-0.5 text-xs text-[#6b7280]">{Object.entries(l.attributes).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</p>}
                  <p className="mt-1 text-sm text-[#6b7280]">{l.quantity} × {fmt(l.unit_price_cents, p.currency)}{l.discount_cents ? ` − ${fmt(l.discount_cents, p.currency)}` : ''}</p>
                </div>
                <div className="shrink-0 text-right font-medium text-[#111827]">{fmt(l.line_total_cents, p.currency)}</div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="border-t border-[#e5e7eb] px-6 py-4 text-sm">
            <TotalRow label="Subtotal" value={fmt(p.subtotal_cents, p.currency)} />
            {p.discount_cents > 0 && <TotalRow label="Discount" value={`− ${fmt(p.discount_cents, p.currency)}`} />}
            {p.tax_cents > 0 && <TotalRow label="Tax" value={fmt(p.tax_cents, p.currency)} />}
            <div className="mt-1 border-t border-[#e5e7eb] pt-1"><TotalRow label="Total" value={fmt(p.total_cents, p.currency)} strong /></div>
          </div>

          {p.customer_notes && <div className="border-t border-[#e5e7eb] px-6 py-4"><p className="mb-1 text-xs font-medium text-[#9ca3af]">Notes</p><p className="whitespace-pre-wrap text-sm text-[#4b5563]">{p.customer_notes}</p></div>}
          {p.terms && <div className="border-t border-[#e5e7eb] px-6 py-4"><p className="mb-1 text-xs font-medium text-[#9ca3af]">Terms &amp; conditions</p><p className="whitespace-pre-wrap text-sm text-[#4b5563]">{p.terms}</p></div>}

          {(p.supportEmail || p.supportPhone) && <div className="border-t border-[#e5e7eb] px-6 py-3 text-xs text-[#9ca3af]">Questions? Contact {[p.supportEmail, p.supportPhone].filter(Boolean).join(' · ')}</div>}
        </div>

        <ProposalPublicActions token={token} done={done} expired={p.is_expired} status={p.status} />
        <p className="mt-6 text-center text-xs text-[#9ca3af] print:hidden">Powered by Scalix</p>
      </div>
    </main>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = { sent: 'bg-blue-100 text-blue-700', viewed: 'bg-blue-100 text-blue-700', accepted: 'bg-green-100 text-green-700', declined: 'bg-red-100 text-red-700', expired: 'bg-red-100 text-red-700', converted: 'bg-violet-100 text-violet-700' }
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>{status}</span>
}
function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex items-center justify-between py-0.5"><span className="text-[#6b7280]">{label}</span><span className={strong ? 'font-semibold text-[#111827]' : 'text-[#111827]'}>{value}</span></div>
}

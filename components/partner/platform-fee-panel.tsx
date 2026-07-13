import { StatCard, Panel, EmptyRow, money } from '@/components/partner/ui'
import type { PlatformFeeSummary } from '@/lib/billing/platform-summary'

// Platform Fee — the $97/mo-per-active-client subscription, shown SEPARATELY from the usage wallet on the
// Balance page. Server-rendered (read-only). Partner-safe: no provider costs or vendor names.

const STATUS_LABEL: Record<PlatformFeeSummary['status'], { text: string; tone: string }> = {
  none: { text: 'Not started', tone: 'text-subtle' },
  active: { text: 'Active', tone: 'text-emerald-600' },
  past_due: { text: 'Payment retrying', tone: 'text-amber-600' },
  payment_required: { text: 'Action required', tone: 'text-red-600' },
  canceled: { text: 'Canceled', tone: 'text-subtle' },
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function PlatformFeePanel({ summary }: { summary: PlatformFeeSummary }) {
  const s = summary
  const status = STATUS_LABEL[s.status] ?? STATUS_LABEL.none
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active Clients" value={String(s.activeClients)} hint={`billed × ${money(s.perClientCents)}/mo`} accent />
        <StatCard label="Monthly Platform Total" value={money(s.monthlyTotalCents)} hint="charged to your card, separate from balance" />
        <StatCard label="Next Invoice" value={fmtDate(s.nextInvoiceDate)} hint={s.hasSubscription ? 'auto-renews' : 'no subscription yet'} />
        <StatCard label="Subscription" value={<span className={status.tone}>{status.text}</span>} hint={s.graceUntil && s.status === 'past_due' ? `grace until ${fmtDate(s.graceUntil)}` : `qty ${s.billedQuantity}`} />
      </div>

      {s.status === 'payment_required' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Your platform subscription payment failed and the grace period has ended. Update your card to
          restore service — your clients and data are safe.
        </div>
      )}

      <Panel title="Recent Platform Invoices">
        {s.recentInvoices.length === 0 ? (
          <EmptyRow>No platform invoices yet.</EmptyRow>
        ) : (
          <div className="divide-y divide-hairline">
            {s.recentInvoices.map((inv, i) => (
              <div key={i} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-ink">{inv.type === 'invoice_paid' ? 'Paid' : 'Failed'}</span>
                <span className="text-subtle">{fmtDate(inv.at)}</span>
                <span className="font-medium tabular-nums text-ink">{money(inv.amountCents)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

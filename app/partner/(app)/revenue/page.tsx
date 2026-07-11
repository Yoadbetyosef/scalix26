import { redirect } from 'next/navigation'
import { TrendingUp, Building2 } from 'lucide-react'
import { getPartnerContext } from '@/lib/partner/rbac'
import { resolvePartnerEconomics, getPartnerClients } from '@/lib/partner/economics-resolve'
import { computeWholesaleSummary } from '@/lib/partner/wholesale'
import { getBusinesses } from '@/lib/partner/company'
import { money } from '@/components/partner/ui'

export const dynamic = 'force-dynamic'

// Revenue — the owner's own company numbers only. No cost, wholesale, or platform economics ever appear.
export default async function RevenuePage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const econ = await resolvePartnerEconomics(ctx.partnerId)
  if (econ.billingMode !== 'white_label' && econ.billingMode !== 'reseller') redirect('/partner')

  const [clients, businesses] = await Promise.all([getPartnerClients(ctx.partnerId), getBusinesses(ctx.partnerId)])
  const summary = computeWholesaleSummary(clients)
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const addedThisMonth = clients.filter((c) => c.status === 'active' && c.created_at >= monthStart).reduce((a, c) => a + (c.retail_price_cents || 0), 0)
  const earners = [...businesses].filter((b) => b.mrrCents > 0).sort((a, b) => b.mrrCents - a.mrrCents)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Revenue</h1>
        <p className="mt-1 text-sm text-subtle">Your company’s recurring revenue and growth.</p>
      </div>

      <section className="sx-animate-in grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-accent/30 bg-surface p-5 shadow-e1">
          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">Monthly recurring revenue</div>
          <div className="mt-2 text-[32px] font-semibold leading-none tracking-tight tabular-nums text-accent-strong">{summary.monthly_retail_cents > 0 ? money(summary.monthly_retail_cents) : '$0'}</div>
          {addedThisMonth > 0 && <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><TrendingUp className="h-3.5 w-3.5" /> +{money(addedThisMonth)} this month</div>}
        </div>
        <div className="rounded-2xl border border-hairline bg-surface p-5 shadow-e1">
          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">Annual run rate</div>
          <div className="mt-2 text-[32px] font-semibold leading-none tracking-tight tabular-nums text-ink">{summary.monthly_retail_cents > 0 ? money(summary.monthly_retail_cents * 12) : '$0'}</div>
          <div className="mt-2 text-xs text-subtle">Projected from current MRR</div>
        </div>
        <div className="rounded-2xl border border-hairline bg-surface p-5 shadow-e1">
          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">Paying businesses</div>
          <div className="mt-2 text-[32px] font-semibold leading-none tracking-tight tabular-nums text-ink">{earners.length}</div>
          <div className="mt-2 text-xs text-subtle">{summary.new_this_month} added this month</div>
        </div>
      </section>

      <section className="sx-animate-in rounded-2xl border border-hairline bg-surface shadow-e1" style={{ animationDelay: '80ms' }}>
        <div className="border-b border-hairline px-4 py-3"><h2 className="font-semibold text-ink">Revenue by business</h2></div>
        <div className="divide-y divide-hairline">
          {earners.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">Set a plan on your businesses to start tracking revenue.</p>
          ) : earners.map((b) => (
            <div key={b.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-sunken text-accent-strong"><Building2 className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{b.name}</div>
                <div className="text-xs text-subtle">{b.planLabel || 'Custom plan'}</div>
              </div>
              <div className="text-sm font-semibold tabular-nums text-ink">{money(b.mrrCents)}<span className="text-xs font-normal text-muted">/mo</span></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

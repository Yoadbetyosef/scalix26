import Link from 'next/link'
import { getPartnerContext } from '@/lib/partner/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { PageHeader, StatCard, Panel, money } from '@/components/partner/ui'
import { Share2, MonitorPlay, GraduationCap, ArrowRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function PartnerDashboard() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const db = createAdminClient()

  const [{ data: stats }, { count: linkCount }, { count: demoCount }] = await Promise.all([
    db.from('partner_stats').select('*').eq('partner_id', ctx.partnerId).maybeSingle(),
    db.from('referral_links').select('id', { count: 'exact', head: true }).eq('partner_id', ctx.partnerId),
    db.from('demos').select('id', { count: 'exact', head: true }).eq('partner_id', ctx.partnerId),
  ])

  const s = stats || {}
  const hasLink = (linkCount ?? 0) > 0
  const hasDemo = (demoCount ?? 0) > 0

  // Time-To-First-Customer quick start — the North Star made actionable.
  const steps = [
    { done: hasLink, label: 'Create your referral link', href: '/partner/referrals', icon: Share2 },
    { done: hasDemo, label: 'Generate a demo for a prospect', href: '/partner/demos', icon: MonitorPlay },
    { done: (s.total_customers ?? 0) > 0, label: 'Close your first customer', href: '/partner/customers', icon: ArrowRight },
    { done: false, label: 'Get certified in the Academy', href: '/partner/learning', icon: GraduationCap },
  ]

  return (
    <div>
      <PageHeader title={`Welcome${ctx.companyName ? `, ${ctx.companyName}` : ''}`} subtitle="Your distribution business at a glance." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="MRR Generated" value={money(s.mrr_generated_cents ?? 0)} hint="Monthly recurring you drive" accent />
        <StatCard label="Active Customers" value={s.active_customers ?? 0} hint={`${s.total_customers ?? 0} total`} />
        <StatCard label="Pending Commission" value={money(s.pending_commission_cents ?? 0)} hint="Awaiting payout" />
        <StatCard label="Lifetime Earnings" value={money(s.lifetime_earnings_cents ?? 0)} hint="Paid to date" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="New (30d)" value={s.new_customers_30d ?? 0} />
        <StatCard label="Trials" value={s.trial_customers ?? 0} />
        <StatCard label="Conversion" value={s.conversion_rate != null ? `${s.conversion_rate}%` : '—'} />
        <StatCard label="Health Score" value={s.health_score != null ? s.health_score : '—'} hint="0–100" />
      </div>

      <div className="mt-6">
        <Panel title="Get to your first customer">
          <ul className="divide-y divide-hairline">
            {steps.map(({ done, label, href, icon: Icon }) => (
              <li key={label}>
                <Link href={href} className="flex items-center gap-3 py-3 transition-colors hover:text-ink">
                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${done ? 'bg-accent/15 text-accent-strong' : 'bg-sunken text-muted'}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className={`flex-1 text-sm ${done ? 'text-muted line-through' : 'text-ink'}`}>{label}</span>
                  <ArrowRight className="h-4 w-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}

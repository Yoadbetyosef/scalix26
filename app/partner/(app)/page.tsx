import Link from 'next/link'
import { getPartnerContext } from '@/lib/partner/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { refreshPartnerStats } from '@/lib/partner/stats'
import { getCoach } from '@/lib/partner/coach'
import { levelForXp } from '@/lib/partner/xp'
import { PageHeader, StatCard, Panel, money } from '@/components/partner/ui'
import { CheckCircle2, Circle, ArrowRight, Flame, Trophy } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function PartnerDashboard() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const db = createAdminClient()

  const stats = await refreshPartnerStats(ctx.partnerId)
  const [{ count: totalPartners }, coach] = await Promise.all([
    db.from('partners').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    getCoach(ctx.partnerId, stats),
  ])
  const lvl = levelForXp(stats.xp)
  const nextPayout = stats.pending_commission_cents // approved+pending shown as "next payout" potential
  const projMonthly = stats.mrr_generated_cents
  const projAnnual = projMonthly * 12

  return (
    <div>
      <PageHeader
        title={`Welcome back${ctx.companyName ? `, ${ctx.companyName}` : ''}`}
        subtitle="Here's your money, your rank, and exactly what to do next."
        action={stats.streak_days > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-600"><Flame className="h-4 w-4" /> {stats.streak_days}-day streak</span>
        ) : undefined}
      />

      {/* Money + rank — the four things a partner must see instantly. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="💰 Total Earnings" value={money(stats.lifetime_earnings_cents)} hint="Paid to date" accent />
        <StatCard label="🏆 Global Rank" value={`#${stats.global_rank ?? '—'}`} hint={`of ${totalPartners ?? 1} partners`} />
        <StatCard label="💵 Next Payout" value={money(nextPayout)} hint="Pending + approved" />
        <StatCard label="📈 Monthly Income" value={money(projMonthly)} hint="Recurring you generate" />
      </div>

      {/* Tier + XP progress */}
      <div className="mt-4">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><Trophy className="h-6 w-6" /></div>
              <div>
                <div className="text-lg font-semibold text-ink">{lvl.level} Partner</div>
                <div className="text-sm text-subtle">{stats.xp.toLocaleString()} XP{lvl.nextLevel ? ` · ${lvl.xpToNext?.toLocaleString()} XP to ${lvl.nextLevel}` : ' · max level'}</div>
              </div>
            </div>
            <div className="text-right text-sm text-subtle">
              <div>{stats.active_customers} active · {stats.total_customers} referred</div>
              <div className="text-xs text-muted">On track for {money(projAnnual)}/yr</div>
            </div>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${lvl.progressPct}%` }} />
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* AI Sales Coach */}
        <Panel title="🧠 Your AI Sales Coach">
          <div className="space-y-2.5">
            {coach.cards.map((c, i) => (
              <div key={i} className={`rounded-xl border p-3 ${c.tone === 'win' ? 'border-green-200 bg-green-50/50' : c.tone === 'action' ? 'border-accent/25 bg-accent/5' : 'border-hairline bg-surface'}`}>
                <div className="flex items-start gap-2.5">
                  <span className="text-xl leading-none">{c.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{c.title}</div>
                    {c.body && <div className="mt-0.5 text-sm text-subtle">{c.body}</div>}
                    {c.cta && c.href && <Link href={c.href} className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:underline">{c.cta} <ArrowRight className="h-3.5 w-3.5" /></Link>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Missions */}
        <Panel title="🎯 Missions">
          <ul className="space-y-1">
            {coach.missions.map((m) => (
              <li key={m.key}>
                <Link href={m.href} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-sunken/50">
                  {m.done ? <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600" /> : <Circle className="h-5 w-5 flex-shrink-0 text-muted" />}
                  <span className={`flex-1 text-sm ${m.done ? 'text-muted line-through' : 'text-ink'}`}>{m.label}</span>
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent-strong">+{m.xp} XP</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 px-2 text-xs text-muted">Complete missions to earn XP, climb the leaderboard, and unlock partner tiers.</p>
        </Panel>
      </div>
    </div>
  )
}

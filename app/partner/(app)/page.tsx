import Link from 'next/link'
import { getPartnerContext } from '@/lib/partner/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { getPartnerStatsCached } from '@/lib/partner/stats'
import { getCoach } from '@/lib/partner/coach'
import { getDashboardExtras } from '@/lib/partner/dashboard'
import { levelForXp, levelBenefits } from '@/lib/partner/xp'
import { enabledPartnerModules } from '@/lib/partner/modules'
import { PageHeader, StatCard, Panel, money, CoachIcon } from '@/components/partner/ui'
import { ArrowRight, Flame, Trophy, Brain, Target, Sparkles, Zap, CheckCircle2, MonitorPlay, Link2, Megaphone, PenLine, Users } from 'lucide-react'

export const dynamic = 'force-dynamic'

const QUICK_ICON: Record<string, typeof Zap> = { demo: MonitorPlay, link: Link2, campaign: Megaphone, write: PenLine, team: Users }
const relTime = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`
}

export default async function PartnerDashboard() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const db = createAdminClient()

  const enabledModules = enabledPartnerModules({ enabled_modules: ctx.enabledModulesRaw })
  const stats = await getPartnerStatsCached(ctx.partnerId)
  const [{ count: totalPartners }, coach] = await Promise.all([
    db.from('partners').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    getCoach(ctx.partnerId, stats),
  ])
  const extras = await getDashboardExtras(ctx.partnerId, enabledModules, stats, coach.signals)
  const lvl = levelForXp(stats.xp)
  const benefits = levelBenefits(lvl.nextLevelKey)

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back${ctx.companyName ? `, ${ctx.companyName}` : ''}`}
        subtitle="Your distribution business — what to do today, and where it's headed."
        action={stats.streak_days > 0 ? <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-600"><Flame className="h-4 w-4" /> {stats.streak_days}-day streak</span> : undefined}
      />

      {/* 1 — TODAY'S FOCUS */}
      <section className="rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/5 to-transparent p-5 shadow-e1">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-accent-strong" />
          <h2 className="text-lg font-semibold text-ink">Today&apos;s Focus</h2>
        </div>
        {extras.focus.length === 0 ? (
          <p className="text-sm text-subtle">You&apos;re all caught up. Keep the momentum — generate a demo or share your link.</p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-3">
            {extras.focus.map((f, i) => (
              <Link key={i} href={f.href} className="group flex flex-col justify-between rounded-xl border border-hairline bg-surface p-3.5 transition-shadow hover:shadow-e2">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-accent-strong"><CoachIcon name={f.icon} className="h-5 w-5" /></span>
                  <span className="text-sm font-medium text-ink">{f.title}</span>
                </div>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-strong">{f.cta} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 6 — QUICK ACTIONS */}
      {extras.quickActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {extras.quickActions.map((q) => {
            const Icon = QUICK_ICON[q.key] || Zap
            return (
              <Link key={q.key} href={q.href} className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-surface px-3.5 py-2 text-sm font-medium text-ink shadow-e1 transition-all hover:-translate-y-px hover:shadow-e2">
                <Icon className="h-4 w-4 text-accent-strong" /> {q.label}
              </Link>
            )
          })}
        </div>
      )}

      {/* 3 — BUSINESS METRICS */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Monthly Recurring Income" value={money(stats.monthly_commission_cents)} hint="Your run-rate" accent />
        <StatCard label="Active Customers" value={stats.active_customers} hint={`${stats.total_customers} referred`} />
        <StatCard label="Conversion Rate" value={stats.conversion_rate != null ? `${stats.conversion_rate}%` : '—'} />
        <StatCard label="Next Commission" value={money(stats.pending_commission_cents)} hint="Pending + approved" />
        <StatCard label="Projected Annual" value={money(stats.projected_annual_cents)} hint="At current run-rate" />
      </div>

      {/* 2 — PROGRESSION (with why the next level matters) */}
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
            <div>Rank #{stats.global_rank ?? '—'} of {totalPartners ?? 1}</div>
            <div className="text-xs text-muted">{stats.active_customers} active · lifetime {money(stats.lifetime_earnings_cents)}</div>
          </div>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${lvl.progressPct}%` }} />
        </div>
        {lvl.nextLevel && benefits.length > 0 && (
          <div className="mt-3 rounded-xl bg-sunken/50 p-3">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">{lvl.nextLevel} unlocks</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {benefits.map((b) => <span key={b} className="inline-flex items-center gap-1.5 text-sm text-ink"><CheckCircle2 className="h-3.5 w-3.5 text-accent-strong" /> {b}</span>)}
            </div>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 4 + 8 — AI SALES COACH + ALERTS */}
        <div className="space-y-6">
          {extras.alerts.length > 0 && (
            <Panel title={<span className="inline-flex items-center gap-2"><Zap className="h-4 w-4 text-accent-strong" /> AI Alerts</span>}>
              <div className="space-y-2">
                {extras.alerts.map((a, i) => (
                  <Link key={i} href={a.href || '/partner'} className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3 transition-colors hover:bg-amber-50">
                    <span className="mt-0.5 text-amber-600"><CoachIcon name={a.icon} className="h-4 w-4" /></span>
                    <div><div className="text-sm font-medium text-ink">{a.title}</div>{a.body && <div className="text-sm text-subtle">{a.body}</div>}</div>
                  </Link>
                ))}
              </div>
            </Panel>
          )}
          <Panel title={<span className="inline-flex items-center gap-2"><Brain className="h-4 w-4 text-accent-strong" /> Your AI Sales Coach</span>}>
            <div className="space-y-2.5">
              {coach.cards.map((c, i) => (
                <div key={i} className={`rounded-xl border p-3 ${c.tone === 'win' ? 'border-green-200 bg-green-50/50' : c.tone === 'action' ? 'border-accent/25 bg-accent/5' : 'border-hairline bg-surface'}`}>
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 text-accent-strong"><CoachIcon name={c.icon} className="h-5 w-5" /></span>
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
        </div>

        {/* 5 — MISSIONS grouped + 7 — ACTIVITY */}
        <div className="space-y-6">
          <Panel title={<span className="inline-flex items-center gap-2"><Target className="h-4 w-4 text-accent-strong" /> Missions</span>}>
            {(['daily', 'weekly', 'monthly', 'longterm'] as const).map((group) => (
              <div key={group} className="mb-3 last:mb-0">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{group === 'longterm' ? 'Long-term' : group}</div>
                <div className="space-y-1.5">
                  {extras.missions[group].map((m, i) => {
                    const done = m.current >= m.target
                    const pct = Math.min(100, Math.round((m.current / Math.max(1, m.target)) * 100))
                    return (
                      <Link key={i} href={m.href} className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-sunken/50">
                        <div className="flex items-center gap-2 text-sm">
                          {done ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" /> : <span className="h-4 w-4 flex-shrink-0 rounded-full border-2 border-hairline-strong" />}
                          <span className={`flex-1 ${done ? 'text-muted line-through' : 'text-ink'}`}>{m.label}</span>
                          <span className="text-xs text-muted">{m.current}/{m.target}</span>
                          {m.xp > 0 && <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent-strong">+{m.xp}</span>}
                        </div>
                        {!done && m.target > 1 && <div className="ml-6 mt-1 h-1 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-accent/70" style={{ width: `${pct}%` }} /></div>}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </Panel>

          <Panel title="Recent activity">
            {extras.activity.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted">Your activity will appear here as you work.</div>
            ) : (
              <div className="divide-y divide-hairline">
                {extras.activity.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-sunken text-subtle"><CoachIcon name={a.icon} className="h-4 w-4" /></span>
                    <span className="flex-1 text-sm text-ink">{a.label}</span>
                    <span className="text-xs text-muted">{relTime(a.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

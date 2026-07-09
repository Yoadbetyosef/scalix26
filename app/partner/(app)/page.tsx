import Link from 'next/link'
import { getPartnerContext } from '@/lib/partner/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { getPartnerStatsCached } from '@/lib/partner/stats'
import { getCoach } from '@/lib/partner/coach'
import { getDashboardExtras } from '@/lib/partner/dashboard'
import { resolvePartnerEconomics } from '@/lib/partner/economics-resolve'
import { WholesalePartnerDashboard } from '@/components/partner/partner-wholesale-dashboard'
import { levelForXp, levelBenefits } from '@/lib/partner/xp'
import { enabledPartnerModules } from '@/lib/partner/modules'
import { PageHeader, StatCard, Panel, money, CoachIcon } from '@/components/partner/ui'
import { ArrowRight, Flame, Trophy, Brain, Target, Sparkles, Zap, CheckCircle2, DollarSign, TrendingUp, Activity, Radio, MonitorPlay, Link2, Megaphone, PenLine, Users } from 'lucide-react'

export const dynamic = 'force-dynamic'

const QUICK_ICON: Record<string, typeof Zap> = { demo: MonitorPlay, link: Link2, campaign: Megaphone, write: PenLine, team: Users, followup: Users }
const HEALTH_TIP: Record<string, string> = {
  Referrals: 'create a link and start sharing it', Demos: 'generate a few demos this week', Outreach: 'send a demo to a prospect',
  Campaigns: 'launch your first campaign', Academy: 'earn your certification', Customers: 'close your first customer',
}
const relTime = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'Just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 604800) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function PartnerDashboard() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const db = createAdminClient()

  const enabledModules = enabledPartnerModules({ enabled_modules: ctx.enabledModulesRaw })
  const stats = await getPartnerStatsCached(ctx.partnerId)

  // Resolved economics (single source of truth). Wholesale relationships get a mode-specific
  // dashboard instead of the commission one — never "earn X% commission".
  const econ = await resolvePartnerEconomics(ctx.partnerId)
  if (econ.billingMode === 'white_label' || econ.billingMode === 'reseller') {
    return <WholesalePartnerDashboard mode={econ.billingMode} companyName={ctx.companyName} streak={stats.streak_days} discount={econ.customWholesaleDiscountPct} markup={econ.retailMarkupPct} />
  }

  const [{ count: totalPartners }, coach] = await Promise.all([
    db.from('partners').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    getCoach(ctx.partnerId, stats),
  ])
  const x = await getDashboardExtras(ctx.partnerId, enabledModules, stats, coach.signals, econ)
  const lvl = levelForXp(stats.xp)
  const benefits = levelBenefits(lvl.nextLevelKey)
  const healthColor = x.health.score >= 70 ? 'text-green-600' : x.health.score >= 40 ? 'text-amber-500' : 'text-red-500'
  const weakest = [...x.health.factors].filter((f) => f.score < f.max).sort((a, b) => a.score / a.max - b.score / b.max)[0]

  return (
    <div className="space-y-5 sm:space-y-6 sx-animate-in">
      <PageHeader
        title={`Welcome back${ctx.companyName ? `, ${ctx.companyName}` : ''}`}
        subtitle="Your distribution business — today's plays, your run-rate, and where it's headed."
        action={stats.streak_days > 0 ? <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-600"><Flame className="h-4 w-4" /> {stats.streak_days}-day streak</span> : undefined}
      />

      {/* TODAY'S FOCUS */}
      <section className="rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/[0.06] to-transparent p-5 shadow-e1">
        <div className="mb-3.5 flex items-center gap-2"><Sparkles className="h-5 w-5 text-accent-strong" /><h2 className="text-[15px] font-semibold text-ink">Today&apos;s Focus</h2></div>
        {x.focus.length === 0 ? (
          <p className="text-sm leading-relaxed text-subtle">You&apos;re on top of it today. The fastest way to grow from here: generate a demo and get it in front of one more business.</p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-3">
            {x.focus.map((f, i) => (
              <Link key={i} href={f.href} className="group flex min-h-[104px] flex-col justify-between rounded-xl border border-hairline bg-surface p-4 transition-all hover:-translate-y-0.5 hover:shadow-e2 active:scale-[0.99]">
                <div className="flex items-start gap-2.5"><span className="mt-0.5 text-accent-strong"><CoachIcon name={f.icon} className="h-5 w-5" /></span><span className="text-sm font-medium leading-snug text-ink">{f.title}</span></div>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-strong">{f.cta} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* QUICK ACTIONS (state-aware) */}
      {x.quickActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {x.quickActions.map((q) => {
            const Icon = QUICK_ICON[q.key] || Zap
            return (
              <Link key={q.key} href={q.href}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium shadow-e1 outline-none transition-all hover:-translate-y-0.5 hover:shadow-e2 active:translate-y-0 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/40 ${q.primary ? 'bg-ink text-white hover:bg-ink/90' : 'border border-hairline bg-surface text-ink'}`}>
                <Icon className={`h-4 w-4 ${q.primary ? '' : 'text-accent-strong'}`} /> {q.label}
              </Link>
            )
          })}
        </div>
      )}

      {/* BUSINESS METRICS */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Monthly Recurring Income" value={money(stats.monthly_commission_cents)} hint={stats.monthly_commission_cents > 0 ? 'Your commission run-rate' : 'Refer a business to start earning'} accent />
        <StatCard label="Active Customers" value={stats.active_customers} hint={stats.active_customers > 0 ? `${stats.total_customers} referred all-time` : 'Close your first to begin'} />
        <StatCard label="Conversion Rate" value={stats.conversion_rate != null && stats.total_customers > 0 ? `${stats.conversion_rate}%` : '—'} hint={stats.total_customers > 0 ? 'Signups that became paid' : 'Personalized demos convert best'} />
        <StatCard label="Next Commission" value={money(stats.pending_commission_cents)} hint={stats.pending_commission_cents > 0 ? 'Pending + approved' : 'Paid when a referral converts'} />
        <StatCard label="Lifetime Earned" value={money(stats.lifetime_earnings_cents)} hint="Your all-time payouts" />
      </div>

      {/* MONEY ON THE TABLE + BUSINESS HEALTH */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <div className="flex h-full flex-col rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-transparent p-5 shadow-e1">
          <div className="flex items-center gap-2 text-emerald-700"><DollarSign className="h-5 w-5" /><h2 className="text-[13px] font-semibold uppercase tracking-[0.04em]">Money left on the table</h2></div>
          <div className="mt-1.5 text-[32px] font-bold leading-none tracking-tight text-ink tabular-nums">{money(x.moneyOnTable.monthly_cents)}<span className="ml-1 text-sm font-medium text-subtle">/mo waiting</span></div>
          {x.moneyOnTable.items.length === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-subtle">This is the recurring income sitting in your pipeline. Add prospects and start trials — the moment they&apos;re in flight, your upside shows up here.</p>
          ) : (
            <div className="mt-3.5 space-y-2">
              {x.moneyOnTable.items.map((m, i) => (
                <div key={i} className="flex items-center justify-between text-sm"><span className="text-subtle">{m.label}</span><span className="font-semibold text-emerald-700 tabular-nums">+{money(m.amount_cents)}/mo</span></div>
              ))}
              <Link href="/partner/pipeline" className="inline-flex items-center gap-1 pt-1 text-sm font-medium text-accent-strong hover:underline">Go close them <ArrowRight className="h-3.5 w-3.5" /></Link>
            </div>
          )}
        </div>

        <Panel title={<span className="inline-flex items-center gap-2"><Activity className="h-4 w-4 text-accent-strong" /> Business Health</span>} className="h-full">
          <div className="flex items-start gap-5">
            <div className="text-center">
              <div className={`text-[44px] font-bold leading-none tabular-nums ${healthColor}`}>{x.health.score}</div>
              <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.06em] text-muted">out of 100</div>
            </div>
            <div className="flex-1 space-y-2">
              {x.health.factors.map((f) => {
                const pct = f.score / f.max
                return (
                  <div key={f.label}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className={weakest?.label === f.label ? 'font-medium text-amber-600' : 'text-subtle'}>{f.label}</span>
                      <span className="text-muted tabular-nums">{f.score}/{f.max}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-sunken"><div className={`h-full rounded-full ${pct >= 0.7 ? 'bg-green-500' : pct >= 0.4 ? 'bg-accent/80' : 'bg-amber-400'}`} style={{ width: `${Math.max(pct * 100, f.score > 0 ? 8 : 0)}%` }} /></div>
                  </div>
                )
              })}
            </div>
          </div>
          {weakest && <p className="mt-3.5 border-t border-hairline pt-3 text-xs leading-relaxed text-subtle">Biggest opportunity: <span className="font-medium text-ink">{weakest.label}</span> — {HEALTH_TIP[weakest.label] || 'keep building'} to raise your score.</p>}
        </Panel>
      </div>

      {/* 12-MONTH FORECAST */}
      <div>
        <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-subtle"><TrendingUp className="h-4 w-4" /> 12-month forecast <span className="font-normal text-muted">· at your current pace</span></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Projected Monthly Income" value={money(x.forecast.monthly_cents)} accent />
          <StatCard label="Projected Annual Income" value={money(x.forecast.annual_cents)} />
          <StatCard label="Projected Customers" value={x.forecast.customers} />
          <StatCard label="Projected Tier" value={x.forecast.level} />
        </div>
      </div>

      {/* PROGRESSION + TOP CHANNEL */}
      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <Panel className="h-full lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><Trophy className="h-6 w-6" /></div>
              <div>
                <div className="text-lg font-semibold text-ink">{lvl.level} Partner</div>
                <div className="text-sm text-subtle">{stats.xp.toLocaleString()} XP{lvl.nextLevel ? ` · ${lvl.xpToNext?.toLocaleString()} to ${lvl.nextLevel}` : ' · max level'}</div>
              </div>
            </div>
            <div className="text-right text-sm text-subtle"><div>Rank #{stats.global_rank ?? '—'} <span className="text-muted">of {totalPartners ?? 1}</span></div><div className="text-xs text-muted">{stats.active_customers} active customers</div></div>
          </div>
          <div className="mt-3.5 h-2.5 w-full overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${lvl.progressPct}%` }} /></div>
          {lvl.nextLevel && benefits.length > 0 && (
            <div className="mt-3.5 rounded-xl bg-sunken/50 p-3.5">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-subtle">Reaching {lvl.nextLevel} unlocks</div>
              <div className="grid gap-1.5 sm:grid-cols-2">{benefits.map((b) => <span key={b} className="inline-flex items-center gap-1.5 text-sm text-ink"><CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-accent-strong" /> {b}</span>)}</div>
            </div>
          )}
        </Panel>

        <Panel title={<span className="inline-flex items-center gap-2"><Radio className="h-4 w-4 text-accent-strong" /> Top Channel</span>} className="flex h-full flex-col">
          {x.topChannel ? (
            <div className="flex-1">
              <div className="text-2xl font-semibold tracking-tight text-ink">{x.topChannel.label}</div>
              <div className="mt-0.5 text-sm text-subtle">{x.topChannel.customers} customer{x.topChannel.customers === 1 ? '' : 's'} acquired here</div>
              <Link href="/partner/marketing" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:underline">Open Marketing OS <ArrowRight className="h-3.5 w-3.5" /></Link>
            </div>
          ) : <p className="flex-1 text-sm leading-relaxed text-subtle">Your best-performing acquisition channel appears here once you launch a campaign or share a link.</p>}
          <p className="mt-3 border-t border-hairline pt-2.5 text-[11px] text-muted">Meta · Google · TikTok · LinkedIn sync in from the Marketing OS.</p>
        </Panel>
      </div>

      {/* GOALS */}
      <Panel title="Your goals">
        <div className="grid gap-5 sm:grid-cols-3">
          {x.goals.map((g) => {
            const pct = Math.min(100, Math.round((g.current / Math.max(1, g.target)) * 100))
            const done = g.current >= g.target
            const fmt = (n: number) => g.unit === 'money' ? money(n) : `${n}`
            return (
              <div key={g.key}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm text-subtle">{g.label}</span>
                  <span className="text-sm font-semibold tabular-nums text-ink">{fmt(g.current)}<span className="font-normal text-muted"> / {fmt(g.target)}</span></span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-sunken"><div className={`h-full rounded-full transition-all ${done ? 'bg-green-500' : 'bg-accent'}`} style={{ width: `${pct}%` }} /></div>
                <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted">
                  {done ? <><CheckCircle2 className="h-3 w-3 text-green-600" /> Goal reached</> : `${fmt(Math.max(0, g.target - g.current))} to go`}
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      <div className="grid items-start gap-5 sm:gap-6 lg:grid-cols-2">
        {/* AI ALERTS + COACH */}
        <div className="space-y-5 sm:space-y-6">
          {x.alerts.length > 0 && (
            <Panel title={<span className="inline-flex items-center gap-2"><Zap className="h-4 w-4 text-accent-strong" /> AI Alerts</span>}>
              <div className="space-y-2">
                {x.alerts.map((a, i) => (
                  <Link key={i} href={a.href || '/partner'} className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3 transition-colors hover:bg-amber-50 active:scale-[0.99]">
                    <span className="mt-0.5 text-amber-600"><CoachIcon name={a.icon} className="h-4 w-4" /></span>
                    <div><div className="text-sm font-medium leading-snug text-ink">{a.title}</div>{a.body && <div className="mt-0.5 text-sm leading-snug text-subtle">{a.body}</div>}</div>
                  </Link>
                ))}
              </div>
            </Panel>
          )}
          <Panel title={<span className="inline-flex items-center gap-2"><Brain className="h-4 w-4 text-accent-strong" /> Your AI Sales Coach</span>}>
            <div className="space-y-2.5">
              {coach.cards.map((c, i) => (
                <div key={i} className={`rounded-xl border p-3.5 ${c.tone === 'win' ? 'border-green-200 bg-green-50/50' : c.tone === 'action' ? 'border-accent/25 bg-accent/[0.06]' : 'border-hairline bg-surface'}`}>
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 text-accent-strong"><CoachIcon name={c.icon} className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium leading-snug text-ink">{c.title}</div>
                      {c.body && <div className="mt-0.5 text-sm leading-snug text-subtle">{c.body}</div>}
                      {c.cta && c.href && <Link href={c.href} className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:underline">{c.cta} <ArrowRight className="h-3.5 w-3.5" /></Link>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* MISSIONS + ACTIVITY */}
        <div className="space-y-5 sm:space-y-6">
          <Panel title={<span className="inline-flex items-center gap-2"><Target className="h-4 w-4 text-accent-strong" /> Missions</span>}>
            {(['daily', 'weekly', 'monthly', 'longterm'] as const).map((group) => (
              <div key={group} className="mb-4 last:mb-0">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{group === 'longterm' ? 'Long-term' : group}</div>
                <div className="space-y-1">
                  {x.missions[group].map((m, i) => {
                    const done = m.current >= m.target
                    const pct = Math.min(100, Math.round((m.current / Math.max(1, m.target)) * 100))
                    return (
                      <Link key={i} href={m.href} className="block rounded-lg px-2 py-2 transition-colors hover:bg-sunken/50">
                        <div className="flex items-center gap-2.5 text-sm">
                          {done ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" /> : <span className="h-4 w-4 flex-shrink-0 rounded-full border-2 border-hairline-strong" />}
                          <span className={`flex-1 ${done ? 'text-muted line-through' : 'text-ink'}`}>{m.label}</span>
                          <span className="text-xs tabular-nums text-muted">{m.current}/{m.target}</span>
                          {m.xp > 0 && <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent-strong">+{m.xp}</span>}
                        </div>
                        {!done && m.target > 1 && <div className="ml-[26px] mt-1.5 h-1 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-accent/70" style={{ width: `${pct}%` }} /></div>}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </Panel>

          <Panel title="Recent activity">
            {x.activity.length === 0 ? (
              <div className="py-8 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-sunken text-muted"><Activity className="h-5 w-5" /></div>
                <p className="text-sm text-subtle">Nothing yet — every link, demo, and customer will show up here.</p>
                <p className="mt-0.5 text-xs text-muted">Start with a demo to see your first entry.</p>
              </div>
            ) : (
              <div className="divide-y divide-hairline">
                {x.activity.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-sunken text-subtle"><CoachIcon name={a.icon} className="h-4 w-4" /></span>
                    <span className="flex-1 text-sm leading-snug text-ink">{a.label}</span>
                    <span className="flex-shrink-0 text-xs text-muted">{relTime(a.at)}</span>
                  </div>
                ))}
              </div>
            )}
            {x.ecosystem.length > 0 && (
              <div className="mt-3 border-t border-hairline pt-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Across the network</div>
                <div className="space-y-2">
                  {x.ecosystem.slice(0, 3).map((e, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-sm text-subtle"><Flame className="h-3.5 w-3.5 flex-shrink-0 text-orange-400" /><span className="flex-1 leading-snug">{e.label}</span><span className="flex-shrink-0 text-xs text-muted">{relTime(e.at)}</span></div>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

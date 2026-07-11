import Link from 'next/link'
import { Building2, Bot, DollarSign, Plus, Users, Palette, ArrowUpRight, MessageSquare, Phone, CalendarCheck, Sparkles, TrendingUp, CircleAlert, CheckCircle2, Rocket } from 'lucide-react'
import type { CompanyOverview } from '@/lib/partner/company'
import { money } from '@/components/partner/ui'

const rel = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: typeof Plus; label: string }) {
  return (
    <Link href={href}
      className="group inline-flex items-center gap-2 rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-medium text-ink shadow-e1 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-e2 active:scale-[0.98]">
      <Icon className="h-4 w-4 text-accent-strong transition-transform group-hover:scale-110" />
      {label}
    </Link>
  )
}

function TodayStat({ icon: Icon, value, label }: { icon: typeof MessageSquare; value: number; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3 shadow-e1">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-sunken text-accent-strong"><Icon className="h-[18px] w-[18px]" /></span>
      <div>
        <div className="text-xl font-semibold leading-none tracking-tight tabular-nums text-ink">{value.toLocaleString()}</div>
        <div className="mt-1 text-xs text-subtle">{label}</div>
      </div>
    </div>
  )
}

// The launchpad shown before the first business exists — sells the dream, not an empty table.
function Launchpad({ companyName }: { companyName: string }) {
  return (
    <div className="sx-animate-in mx-auto max-w-xl py-14 text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-accent text-white shadow-e2">
        <Rocket className="h-8 w-8" />
      </div>
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Launch {companyName}</h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-subtle">
        Spin up a branded AI workforce for your first customer in under two minutes. Every business you add
        runs 24/7 — answering calls, texts, and chats, and booking jobs while you sleep.
      </p>
      <Link href="/partner/businesses?new=1"
        className="mt-7 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-[15px] font-semibold text-white shadow-e2 transition-all duration-150 hover:-translate-y-0.5 hover:brightness-105 active:scale-[0.98]">
        <Plus className="h-5 w-5" /> Create your first business
      </Link>
      <div className="mt-8 flex items-center justify-center gap-6 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><Palette className="h-3.5 w-3.5" /> Your brand</span>
        <span className="inline-flex items-center gap-1.5"><Bot className="h-3.5 w-3.5" /> AI employees</span>
        <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Live in minutes</span>
      </div>
    </div>
  )
}

export function CompanyHome({ overview, companyName }: { overview: CompanyOverview; companyName: string }) {
  const o = overview
  if (o.businessCount === 0) return <Launchpad companyName={companyName} />

  const hasMrr = o.mrrCents > 0
  const healthy = o.healthyPct >= 100

  return (
    <div className="space-y-8">
      {/* ── Revenue hero — the emotional center: this is MY company's revenue ── */}
      <section className="sx-animate-in relative overflow-hidden rounded-3xl border border-hairline bg-gradient-to-b from-surface to-sunken/40 px-6 py-10 text-center shadow-e1">
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full"
          style={{ background: 'radial-gradient(circle, color-mix(in oklab, var(--color-accent) 14%, transparent), transparent 70%)' }} />
        <p className="relative text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{companyName} · Monthly recurring revenue</p>
        <div className="relative mt-2 text-[56px] font-semibold leading-none tracking-tight tabular-nums text-ink">
          {hasMrr ? money(o.mrrCents) : '$0'}<span className="text-2xl font-normal text-muted">/mo</span>
        </div>
        {o.mrrDeltaCents > 0 && (
          <p className="relative mt-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
            <TrendingUp className="h-4 w-4" /> +{money(o.mrrDeltaCents)} this month
          </p>
        )}
        <div className="relative mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-subtle">
          <span className="inline-flex items-center gap-1.5"><Building2 className="h-4 w-4" /> {o.businessCount} {o.businessCount === 1 ? 'business' : 'businesses'}</span>
          <span className="text-hairline-strong">·</span>
          <span className="inline-flex items-center gap-1.5"><Bot className="h-4 w-4" /> {o.aiEmployeeCount} AI {o.aiEmployeeCount === 1 ? 'employee' : 'employees'}</span>
          <span className="text-hairline-strong">·</span>
          <span className={`inline-flex items-center gap-1.5 ${healthy ? 'text-emerald-600' : 'text-amber-600'}`}>
            <span className={`h-2 w-2 rounded-full ${healthy ? 'bg-emerald-500' : 'bg-amber-500'}`} /> {healthy ? 'All healthy' : `${o.healthyPct}% healthy`}
          </span>
          {o.profitCents > 0 && <><span className="text-hairline-strong">·</span><span className="inline-flex items-center gap-1.5"><DollarSign className="h-4 w-4" /> {money(o.profitCents)}/mo profit</span></>}
        </div>
        <div className="relative mt-7 flex flex-wrap items-center justify-center gap-2.5">
          <Link href="/partner/businesses?new=1"
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-e2 transition-all duration-150 hover:-translate-y-0.5 hover:brightness-105 active:scale-[0.98]">
            <Plus className="h-4 w-4" /> New Business
          </Link>
          <QuickAction href="/partner/team" icon={Users} label="Invite team" />
          <QuickAction href="/partner/branding" icon={Palette} label="Customize brand" />
        </div>
      </section>

      {/* ── Today across your company ── */}
      <section className="sx-animate-in" style={{ animationDelay: '60ms' }}>
        <h2 className="mb-3 text-sm font-semibold text-subtle">Today across your company</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TodayStat icon={MessageSquare} value={o.today.messages} label="Messages" />
          <TodayStat icon={Phone} value={o.today.calls} label="Calls" />
          <TodayStat icon={CalendarCheck} value={o.today.bookings} label="Bookings" />
          <TodayStat icon={Sparkles} value={o.today.leads} label="New leads" />
        </div>
      </section>

      {/* ── Recent activity + Needs attention ── */}
      <section className="sx-animate-in grid gap-4 md:grid-cols-2" style={{ animationDelay: '120ms' }}>
        <div className="rounded-2xl border border-hairline bg-surface shadow-e1">
          <div className="border-b border-hairline px-4 py-3"><h2 className="font-semibold text-ink">Recent activity</h2></div>
          <div className="p-2">
            {o.recent.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">Activity from your businesses will appear here.</p>
            ) : o.recent.map((r, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-sunken text-accent-strong">
                  {r.kind === 'business' ? <Building2 className="h-4 w-4" /> : r.kind === 'booking' ? <CalendarCheck className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.text}</span>
                <span className="flex-shrink-0 text-xs text-muted">{rel(r.at)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-hairline bg-surface shadow-e1">
          <div className="border-b border-hairline px-4 py-3"><h2 className="font-semibold text-ink">Needs attention</h2></div>
          <div className="p-2">
            {o.attention.length === 0 ? (
              <div className="flex items-center gap-3 px-3 py-8 text-sm text-subtle">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-500" /> Everything’s running smoothly.
              </div>
            ) : o.attention.map((a, i) => (
              <Link key={i} href="/partner/businesses"
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-sunken/60">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><CircleAlert className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{a.name}</div>
                  <div className="text-xs text-subtle">{a.reason}</div>
                </div>
                <ArrowUpRight className="h-4 w-4 flex-shrink-0 text-amber-400" />
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

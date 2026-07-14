'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PlanNavigation } from '@/lib/command-center/plan-adapter'
import type { DailyAction, PrimaryMetric } from '@/lib/command-center/plan'

const money = (c: number) => (Math.abs(c) >= 100000000 ? `$${(c / 100000000).toFixed(2)}B` : Math.abs(c) >= 100000 ? `$${(c / 100000).toFixed(0)}K` : `$${(c / 100).toFixed(0)}`)
const MONEY_METRICS = new Set<PrimaryMetric>(['arr_cents', 'mrr_cents', 'revenue', 'profit'])
const fmtGoal = (metric: PrimaryMetric, v: number) => (MONEY_METRICS.has(metric) ? money(v) : `${Math.round(v).toLocaleString()} customers`)
const METRIC_LABEL: Record<PrimaryMetric, string> = { arr_cents: 'ARR', mrr_cents: 'MRR', paying_customers: 'Paying customers', revenue: 'Revenue', profit: 'Profit' }
const STATUS_TONE: Record<string, string> = { ahead: 'text-emerald-600', on_track: 'text-emerald-600', behind: 'text-red-600', no_data: 'text-subtle' }

export function PlanView({ nav }: { nav: PlanNavigation }) {
  const router = useRouter()
  const { cascade: c, config } = nav
  const [done, setDone] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(!nav.configured)

  const logAction = async (a: DailyAction, status: 'done' | 'dismissed') => {
    let dismissReason: string | null = null
    if (status === 'dismissed') { dismissReason = prompt('Skip reason?'); if (dismissReason == null) return }
    setBusy(true); setErr(null)
    try {
      const gap = { gapKey: `plan:${a.key}:${new Date().toISOString().slice(0, 10)}`, scope: 'today', title: a.action, category: a.engine ?? 'plan', priority: 'high', requiredResult: null, expectedImpactCents: null, playbook: null }
      const r = await fetch('/api/admin/command-center/war-room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept_gap', gap, status, dismissReason }) })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed')
      setDone((s) => new Set(s).add(a.key))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const behind = c.year.behindPct
  const behindLabel = c.year.status === 'no_data' ? 'Set a target date to track pace' : behind > 0.05 ? `${behind.toFixed(1)}% behind plan` : behind < -0.05 ? `${(-behind).toFixed(1)}% ahead of plan` : 'On plan'

  return (
    <div className="space-y-6">
      {err && <div className="text-xs text-red-600">{err}</div>}

      {/* TODAY — the hero */}
      <div className="rounded-2xl border border-hairline-strong bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold text-ink">Today</h3>
          <span className={`text-sm font-semibold ${behind > 0.05 ? 'text-red-600' : behind < -0.05 ? 'text-emerald-600' : 'text-subtle'}`}>{behindLabel}</span>
        </div>
        <p className="mt-0.5 text-xs text-subtle">To stay on track for {fmtGoal(config.primaryMetric, config.annualTarget)}{config.targetDate ? ` by ${config.targetDate}` : ''}, do these today. Each is calculated backward from the gap.</p>
        <div className="mt-3 space-y-2">
          {c.today.length === 0 && <div className="rounded-xl border border-dashed border-hairline-strong bg-sunken/40 p-3 text-sm text-subtle">Nothing required today — you&apos;re on pace, or set a destination below.</div>}
          {c.today.map((a) => (
            <div key={a.key} className={`flex flex-wrap items-start gap-3 rounded-xl border p-3 ${done.has(a.key) ? 'border-hairline bg-sunken/40 opacity-60' : 'border-hairline-strong bg-white'}`}>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium text-ink ${done.has(a.key) ? 'line-through' : ''}`}>{a.action}</div>
                <div className="text-xs text-subtle">{a.why}</div>
                <div className="mt-0.5 text-[11px] text-subtle">→ {a.relatedGoal} · {a.expectedImpact}</div>
              </div>
              {!done.has(a.key) && a.key !== 'input_required' && a.key !== 'set_destination' && !a.key.endsWith('_input') && (
                <div className="flex gap-2">
                  <button onClick={() => logAction(a, 'done')} disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">Done</button>
                  <button onClick={() => logAction(a, 'dismissed')} disabled={busy} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs">Skip</button>
                </div>
              )}
              {done.has(a.key) && <span className="text-xs text-emerald-600">logged ✓</span>}
            </div>
          ))}
        </div>
      </div>

      {/* GOAL → REALITY → GAP */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-hairline-strong bg-white p-4"><div className="text-[11px] uppercase tracking-wide text-subtle">Goal ({METRIC_LABEL[config.primaryMetric]})</div><div className="text-2xl font-bold text-ink">{fmtGoal(config.primaryMetric, c.year.target)}</div><div className="text-xs text-subtle">{config.targetDate ? `by ${config.targetDate}` : 'no date set'}{c.year.monthsRemaining != null ? ` · ${c.year.monthsRemaining.toFixed(1)} mo left` : ''}</div></div>
        <div className="rounded-xl border border-hairline-strong bg-white p-4"><div className="text-[11px] uppercase tracking-wide text-subtle">Reality (now)</div><div className="text-2xl font-bold text-ink">{fmtGoal(config.primaryMetric, c.year.current)}</div><div className="text-xs text-subtle">{(c.year.progressPct * 100).toFixed(1)}% of goal <span className="rounded bg-sky-100 px-1 text-[10px] text-sky-700">Derived Actual</span></div></div>
        <div className="rounded-xl border border-hairline-strong bg-white p-4"><div className="text-[11px] uppercase tracking-wide text-subtle">Gap</div><div className="text-2xl font-bold text-ink">{fmtGoal(config.primaryMetric, c.year.gap)}</div><div className={`text-xs ${STATUS_TONE[c.year.status]}`}>{c.year.status.replace('_', ' ')}{c.year.requiredMonthlyGrowth != null ? ` · need ${(c.year.requiredMonthlyGrowth * 100).toFixed(1)}%/mo` : ''}</div></div>
      </div>

      {/* MONTH / WEEK */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-hairline-strong bg-white p-4">
          <div className="mb-1 text-sm font-semibold text-ink">This Month</div>
          <div className="text-sm text-subtle">Goal <span className="font-medium text-ink">{c.month.requirement}</span> new customers · done <span className="font-medium text-ink">{c.month.actual}</span> · <span className="font-medium text-ink">{c.month.remaining}</span> left · {c.month.daysRemaining} days</div>
          <div className="text-xs text-subtle">Required pace {c.month.requiredDailyPace.toFixed(2)}/day · forecast month-end {c.month.forecastMonthEnd} · <span className={STATUS_TONE[c.month.status]}>{c.month.status.replace('_', ' ')}</span></div>
          {c.year.requiredCustomersCurrentArpu != null && <div className="mt-1 text-[11px] text-subtle">Total required customers: {c.year.requiredCustomersCurrentArpu.toLocaleString()} at current ARPU{c.year.requiredCustomersTargetArpu != null ? ` · ${c.year.requiredCustomersTargetArpu.toLocaleString()} at target ARPU` : ''}</div>}
        </div>
        <div className="rounded-xl border border-hairline-strong bg-white p-4">
          <div className="mb-1 text-sm font-semibold text-ink">This Week</div>
          <div className="text-sm text-subtle">Goal <span className="font-medium text-ink">{c.week.requirement}</span> · done <span className="font-medium text-ink">{c.week.actual}</span> · <span className="font-medium text-ink">{c.week.remaining}</span> left · prior wk {c.week.prior}</div>
          <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-subtle">
            <div>Direct: {c.weekEngines.direct.funnel ? `${c.weekEngines.direct.customers} cust → ${c.weekEngines.direct.funnel.demos} demos → ${c.weekEngines.direct.funnel.outreach} outreach` : c.weekEngines.direct.customers > 0 ? 'Input Required' : '—'}</div>
            <div>Affiliate: {c.weekEngines.affiliate.funnel ? `${c.weekEngines.affiliate.customers} cust → ${c.weekEngines.affiliate.funnel.recruitedAffiliates} recruits` : c.weekEngines.affiliate.customers > 0 ? 'Input Required' : '—'}</div>
            <div>White Label: {c.weekEngines.whiteLabel.funnel ? `${c.weekEngines.whiteLabel.customers} cust → ${c.weekEngines.whiteLabel.funnel.meetings} meetings` : c.weekEngines.whiteLabel.customers > 0 ? 'Input Required' : '—'}</div>
            <div>Expansion: {c.weekEngines.expansion.funnel ? `${money(c.weekEngines.expansion.mrrCents)} → ${c.weekEngines.expansion.funnel.offers} offers` : '—'}</div>
          </div>
        </div>
      </div>

      {/* DESTINATION editor */}
      <div className="rounded-xl border border-hairline-strong bg-white p-4">
        <div className="flex items-center justify-between"><div className="text-sm font-semibold text-ink">Destination</div><button onClick={() => setEditing((v) => !v)} className="text-xs text-ink underline">{editing ? 'Close' : 'Edit destination'}</button></div>
        {editing && <DestinationEditor nav={nav} onSaved={() => { setEditing(false); router.refresh() }} />}
        {!editing && <div className="mt-1 text-xs text-subtle">Allocation — Direct {(config.allocation.direct * 100 / (config.allocation.direct + config.allocation.affiliate + config.allocation.whiteLabel + config.allocation.expansion || 1)).toFixed(0)}% · Affiliate {(config.allocation.affiliate * 100 / (config.allocation.direct + config.allocation.affiliate + config.allocation.whiteLabel + config.allocation.expansion || 1)).toFixed(0)}% · White Label {(config.allocation.whiteLabel * 100 / (config.allocation.direct + config.allocation.affiliate + config.allocation.whiteLabel + config.allocation.expansion || 1)).toFixed(0)}% · Expansion {(config.allocation.expansion * 100 / (config.allocation.direct + config.allocation.affiliate + config.allocation.whiteLabel + config.allocation.expansion || 1)).toFixed(0)}%</div>}
      </div>
    </div>
  )
}

function DestinationEditor({ nav, onSaved }: { nav: PlanNavigation; onSaved: () => void }) {
  const c = nav.config
  const isMoney = MONEY_METRICS.has(c.primaryMetric)
  const [metric, setMetric] = useState<PrimaryMetric>(c.primaryMetric)
  const [target, setTarget] = useState(String(isMoney ? c.annualTarget / 100 : c.annualTarget))
  const [start, setStart] = useState(c.startDate)
  const [date, setDate] = useState(c.targetDate ?? '')
  const [arpuTarget, setArpuTarget] = useState(c.arpuTargetCents ? String(c.arpuTargetCents / 100) : '')
  const [alloc, setAlloc] = useState({ direct: String(Math.round(c.allocation.direct * 100)), affiliate: String(Math.round(c.allocation.affiliate * 100)), whiteLabel: String(Math.round(c.allocation.whiteLabel * 100)), expansion: String(Math.round(c.allocation.expansion * 100)) })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const moneyMetric = MONEY_METRICS.has(metric)

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const t = parseFloat(target) || 0
      const body = {
        primaryMetric: metric, annualTarget: moneyMetric ? Math.round(t * 100) : t, startDate: start, targetDate: date || null,
        arpuTargetCents: arpuTarget ? Math.round(parseFloat(arpuTarget) * 100) : null,
        allocation: { direct: parseFloat(alloc.direct) || 0, affiliate: parseFloat(alloc.affiliate) || 0, whiteLabel: parseFloat(alloc.whiteLabel) || 0, expansion: parseFloat(alloc.expansion) || 0 },
        status: 'active' as const,
      }
      const r = await fetch('/api/admin/command-center/plan', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error((await r.json()).error || 'Save failed')
      onSaved()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const A = (k: keyof typeof alloc, label: string) => <label className="block text-xs text-subtle">{label} %<input value={alloc[k]} onChange={(e) => setAlloc((p) => ({ ...p, [k]: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>

  return (
    <div className="mt-3">
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <label className="block text-xs text-subtle">Primary goal<select value={metric} onChange={(e) => setMetric(e.target.value as PrimaryMetric)} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm">{(Object.keys(METRIC_LABEL) as PrimaryMetric[]).map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}</select></label>
        <label className="block text-xs text-subtle">Target {moneyMetric ? '($)' : '(customers)'}<input value={target} onChange={(e) => setTarget(e.target.value)} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
        <label className="block text-xs text-subtle">Start date<input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
        <label className="block text-xs text-subtle">Target date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
        <label className="block text-xs text-subtle">Target ARPU ($, optional)<input value={arpuTarget} onChange={(e) => setArpuTarget(e.target.value)} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
        {A('direct', 'Direct')}{A('affiliate', 'Affiliate')}{A('whiteLabel', 'White Label')}{A('expansion', 'Expansion')}
      </div>
      <div className="mt-2"><button onClick={save} disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Activate plan</button></div>
    </div>
  )
}

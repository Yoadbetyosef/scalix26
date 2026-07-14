'use client'

import { useState } from 'react'

const money = (c: number | null) => (c == null ? '∞' : Math.abs(c) >= 100000000 ? `$${(c / 100000000).toFixed(2)}B` : Math.abs(c) >= 100000 ? `$${(c / 100000).toFixed(0)}K` : `$${(c / 100).toFixed(0)}`)
type Pair<T> = { before: T; after: T }
interface Delta {
  horizonMonth: number
  customers: Pair<number>; mrrCents: Pair<number>; arrCents: Pair<number>
  operatingProfitCents: Pair<number>; cashCents: Pair<number>; runwayMonths: Pair<number | null>
  valuationCents: Pair<number>; timeToTargetMonths: Pair<number | null>
}

function DeltaRow({ label, p, fmt = money }: { label: string; p: Pair<number | null>; fmt?: (n: number | null) => string }) {
  const up = (p.after ?? 0) >= (p.before ?? 0)
  return <tr><td className="px-3 py-2 text-ink">{label}</td><td className="px-3 py-2 tabular-nums text-subtle">{fmt(p.before)}</td><td className="px-3 py-2 tabular-nums font-medium text-ink">{fmt(p.after)}</td><td className={`px-3 py-2 tabular-nums ${up ? 'text-emerald-600' : 'text-red-600'}`}>{up ? '▲' : '▼'}</td></tr>
}

export function MissionPlanner() {
  const [pricing, setPricing] = useState(''); const [churn, setChurn] = useState(''); const [affiliate, setAffiliate] = useState('')
  const [marketing, setMarketing] = useState(''); const [reps, setReps] = useState(''); const [horizon, setHorizon] = useState('60')
  const [delta, setDelta] = useState<Delta | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    setBusy(true); setErr(null)
    try {
      const decisions: unknown[] = []
      if (pricing) decisions.push({ kind: 'increasePricingPct', pct: parseFloat(pricing) / 100 }) // UI is %, engine wants a fraction
      if (churn) decisions.push({ kind: 'setMonthlyChurn', rate: parseFloat(churn) / 100 })
      if (affiliate) decisions.push({ kind: 'setAffiliateActivation', rate: parseFloat(affiliate) / 100 })
      if (marketing) decisions.push({ kind: 'addMarketingBudgetCents', cents: Math.round(parseFloat(marketing) * 100) })
      if (reps) decisions.push({ kind: 'hireSalesReps', count: parseInt(reps), salaryPerMonthCents: 800000 })
      const r = await fetch('/api/admin/command-center/mission-planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decisions, horizonMonth: parseInt(horizon) || 60 }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Simulation failed')
      setDelta(j.delta)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const F = (label: string, v: string, on: (s: string) => void, suffix: string) => (
    <label className="block text-xs text-subtle">{label}<div className="mt-0.5 flex items-center gap-1"><input value={v} onChange={(e) => on(e.target.value)} className="w-full rounded border border-hairline-strong px-2 py-1 text-sm" /><span className="text-[10px] text-subtle">{suffix}</span></div></label>
  )

  return (
    <div>
      <p className="mb-2 text-xs text-subtle">Apply decisions and see the before/after effect on the whole company at a horizon. Outcomes are <span className="rounded bg-violet-100 px-1 text-[10px] text-violet-700">Simulation</span> — no causation claimed, nothing persisted, the Hiring Plan is untouched.</p>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {F('Pricing change', pricing, setPricing, '%')}
        {F('Monthly churn', churn, setChurn, '%')}
        {F('Affiliate activation', affiliate, setAffiliate, '%')}
        {F('Add marketing / mo', marketing, setMarketing, '$')}
        {F('Hire sales reps', reps, setReps, '#')}
        {F('Horizon', horizon, setHorizon, 'mo')}
      </div>
      <div className="mt-2"><button onClick={run} disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">{busy ? 'Simulating…' : 'Simulate'}</button></div>
      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
      {delta && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-hairline-strong">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-subtle"><tr>{['Metric (@ M' + delta.horizonMonth + ')', 'Before', 'After', ''].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-hairline">
              <DeltaRow label="Customers" p={delta.customers} fmt={(n) => (n == null ? '—' : Math.round(n).toLocaleString())} />
              <DeltaRow label="MRR" p={delta.mrrCents} />
              <DeltaRow label="ARR" p={delta.arrCents} />
              <DeltaRow label="Operating profit" p={delta.operatingProfitCents} />
              <DeltaRow label="Cash" p={delta.cashCents} />
              <DeltaRow label="Runway (mo)" p={delta.runwayMonths} fmt={(n) => (n == null ? '∞' : (n as number).toFixed(1))} />
              <DeltaRow label="Valuation" p={delta.valuationCents} />
              <DeltaRow label="Time to target (mo)" p={delta.timeToTargetMonths} fmt={(n) => (n == null ? '—' : (n as number).toFixed(0))} />
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

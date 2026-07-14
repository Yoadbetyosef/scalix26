'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Mission } from '@/lib/command-center/mission-adapter'
import type { EvaluatedMilestone } from '@/lib/command-center/mission-milestones'

const money = (c: number) => (Math.abs(c) >= 100000000 ? `$${(c / 100000000).toFixed(2)}B` : Math.abs(c) >= 100000 ? `$${(c / 100000).toFixed(0)}K` : `$${(c / 100).toFixed(0)}`)
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`
const PCT_METRICS = new Set(['gross_margin', 'logo_churn', 'nrr', 'onboarding_completion'])
const MONEY_METRICS = new Set(['arr_cents', 'arpu_cents'])
function fmtMetric(metricKey: string, v: number | null): string {
  if (v == null) return '—'
  if (MONEY_METRICS.has(metricKey)) return money(v)
  if (PCT_METRICS.has(metricKey)) return pct(v, metricKey === 'logo_churn' || metricKey === 'nrr' ? 1 : 0)
  return v.toLocaleString('en-US')
}
const STATUS_TONE: Record<EvaluatedMilestone['status'], string> = { achieved: 'bg-emerald-100 text-emerald-700', on_track: 'bg-sky-100 text-sky-700', behind: 'bg-amber-100 text-amber-700', no_data: 'bg-gray-100 text-gray-500' }

export function MissionView({ mission }: { mission: Mission }) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const [d, setD] = useState<{ targetValue: string; targetDate: string }>({ targetValue: '', targetDate: '' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)

  const saveMilestone = async (id: string, metricKey: string) => {
    setBusy(true); setErr(null)
    try {
      const raw = parseFloat(d.targetValue)
      const targetValue = isNaN(raw) ? undefined : (MONEY_METRICS.has(metricKey) ? Math.round(raw * 100) : raw)
      const r = await fetch('/api/admin/command-center/mission', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ milestoneId: id, targetValue, targetDate: d.targetDate || null }) })
      if (!r.ok) throw new Error((await r.json()).error || 'Save failed')
      setEditing(null); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const rp = mission.requiredPath
  const wf = mission.waterfall

  return (
    <div className="space-y-6">
      {err && <div className="text-xs text-red-600">{err}</div>}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">ARR contribution (current run-rate · Derived Actual)</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {([['Direct', wf.directCents], ['Affiliate', wf.affiliateCents], ['White Label', wf.whiteLabelCents], ['Expansion', wf.expansionCents], ['Total ARR', wf.totalCents]] as const).map(([label, v]) => (
            <div key={label} className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase tracking-wide text-subtle">{label}</div><div className="text-lg font-bold text-ink">{money(v)}</div></div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-ink">Required path to {money(mission.targetArrCents)} ARR {mission.targetDate ? `by ${mission.targetDate}` : ''}</h3>
        <p className="mb-2 text-xs text-subtle">Deterministic decomposition from current reality — <span className="rounded bg-orange-100 px-1 text-[10px] text-orange-700">Estimate/Forecast</span>, not a promise. No false precision.</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase text-subtle">ARR gap</div><div className="text-lg font-bold text-ink">{money(rp.arrGapCents)}</div></div>
          <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase text-subtle">Net-new customers</div><div className="text-lg font-bold text-ink">{rp.requiredNetNewCustomers.toLocaleString()}</div><div className="text-[11px] text-subtle">to {rp.requiredCustomers.toLocaleString()} total</div></div>
          <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase text-subtle">ARPU uplift</div><div className="text-lg font-bold text-ink">{money(rp.arpuUpliftCents)}</div><div className="text-[11px] text-subtle">to {money(rp.requiredArpuCents)}</div></div>
          <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase text-subtle">Req. monthly growth</div><div className="text-lg font-bold text-ink">{rp.requiredMonthlyGrowth == null ? '— set a date' : pct(rp.requiredMonthlyGrowth, 1)}</div></div>
        </div>
        <div className="mt-2 text-xs text-subtle">By engine (at current mix): Direct +{rp.byEngine.direct.toLocaleString()} · Affiliate +{rp.byEngine.affiliate.toLocaleString()} · White Label +{rp.byEngine.whiteLabel.toLocaleString()} customers.</div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">Milestones</h3>
        <div className="overflow-x-auto rounded-xl border border-hairline-strong">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-subtle"><tr>{['Milestone', 'Current', 'Target', 'Gap', 'Target date', 'Status', ''].map((h) => <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-hairline">
              {mission.milestones.map((m) => (
                <>
                  <tr key={m.def.key}>
                    <td className="px-3 py-2 font-medium text-ink">{m.def.label}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtMetric(m.def.metricKey, m.current)}</td>
                    <td className="px-3 py-2 tabular-nums text-subtle">{fmtMetric(m.def.metricKey, m.target)}</td>
                    <td className="px-3 py-2 tabular-nums text-subtle">{m.gap == null ? '—' : fmtMetric(m.def.metricKey, m.gap)}</td>
                    <td className="px-3 py-2 text-subtle">{m.def.targetDate ?? '—'}{m.forecastDate && <span className="ml-1 text-[10px] text-violet-600">(fc {m.forecastDate})</span>}</td>
                    <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_TONE[m.status]}`}>{m.status.replace('_', ' ')}</span></td>
                    <td className="px-3 py-2"><button onClick={() => { setEditing(editing === m.def.key ? null : m.def.key); setD({ targetValue: MONEY_METRICS.has(m.def.metricKey) ? String(m.target / 100) : String(m.target), targetDate: m.def.targetDate ?? '' }) }} className="text-xs text-ink underline">{editing === m.def.key ? 'Close' : 'Edit'}</button></td>
                  </tr>
                  {editing === m.def.key && (
                    <tr key={m.def.key + '-e'}><td colSpan={7} className="bg-sunken px-3 py-2">
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-xs text-subtle">Target {MONEY_METRICS.has(m.def.metricKey) ? '($)' : PCT_METRICS.has(m.def.metricKey) ? '(0-1)' : '(count)'}<input value={d.targetValue} onChange={(e) => setD((p) => ({ ...p, targetValue: e.target.value }))} className="ml-1 rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
                        <label className="text-xs text-subtle">Target date<input type="date" value={d.targetDate} onChange={(e) => setD((p) => ({ ...p, targetDate: e.target.value }))} className="ml-1 rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
                        <button onClick={() => saveMilestone(mission.milestoneIds[m.def.key] ?? '', m.def.metricKey)} disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Save</button>
                      </div>
                    </td></tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

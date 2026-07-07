'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Customer { id: string; name: string; plan: string | null; revenue: number; cost: number; llm: number; voice: number; sms: number; learning: number; margin: number }
interface CostData {
  period: { daysElapsed: number; daysInMonth: number }
  totals: { llm: number; voice: number; sms: number; learning: number; total: number }
  runRate: { mtd: number; dailyAvg: number; projectedMonth: number }
  margin: { mrr: number; projectedCost: number; grossMargin: number; grossMarginPct: number | null }
  customers: Customer[]
  rates: { note: string }
  anthropic: null | {
    total: number
    byModel: Record<string, number>
    voiceLlmApprox: number
    suggestedVoicePerMin: number | null
    currentVoiceLlmPerMin: number
  }
}

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function AdminCostPage() {
  const [d, setD] = useState<CostData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/cost')
        const j = await res.json()
        if (!res.ok) throw new Error(j.error || 'Failed to load')
        setD(j)
      } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
    })()
  }, [])

  const Tile = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
    <div className="rounded-xl border border-hairline-strong bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone || 'text-ink'}`}>{value}</div>
      {sub && <div className="text-xs text-subtle">{sub}</div>}
    </div>
  )

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink mb-1">Cost & Margin</h1>
      <p className="text-sm text-subtle mb-6">Your running cost (COGS) per customer and platform-wide — this month.</p>

      {err && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{err}</div>}

      {loading || !d ? <p className="text-sm text-muted">Loading…</p> : (
        <>
          <h2 className="mb-2 text-sm font-semibold text-ink">Run rate</h2>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Cost month-to-date" value={money(d.runRate.mtd)} sub={`${d.period.daysElapsed} of ${d.period.daysInMonth} days`} />
            <Tile label="Cost / day (avg)" value={money(d.runRate.dailyAvg)} />
            <Tile label="Projected month" value={money(d.runRate.projectedMonth)} />
            <Tile label="Gross margin" value={d.margin.grossMarginPct === null ? '—' : `${d.margin.grossMarginPct}%`} sub={`${money(d.margin.grossMargin)} (MRR ${money(d.margin.mrr)} − cost)`} tone={d.margin.grossMargin >= 0 ? 'text-emerald-600' : 'text-red-600'} />
          </div>

          <h2 className="mb-2 text-sm font-semibold text-ink">Cost by category (MTD)</h2>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Tile label="AI / LLM" value={money(d.totals.llm)} />
            <Tile label="Voice" value={money(d.totals.voice)} />
            <Tile label="SMS" value={money(d.totals.sms)} />
            <Tile label="Learning" value={money(d.totals.learning)} />
            <Tile label="Total" value={money(d.totals.total)} />
          </div>

          <h2 className="mb-2 text-sm font-semibold text-ink">Anthropic — actual spend (this month)</h2>
          {d.anthropic ? (
            <div className="mb-6 rounded-xl border border-hairline-strong bg-white p-4">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <div><span className="text-2xl font-bold text-ink">{money(d.anthropic.total)}</span> <span className="text-xs text-subtle">total, from Anthropic (ground truth)</span></div>
                <div className="text-sm text-subtle">
                  Suggested voice-LLM: <span className="font-medium text-ink">{d.anthropic.suggestedVoicePerMin === null ? '—' : `$${d.anthropic.suggestedVoicePerMin}/min`}</span> · current: ${d.anthropic.currentVoiceLlmPerMin}/min
                </div>
              </div>
              {Object.keys(d.anthropic.byModel).length > 0 && (
                <div className="mt-3 grid grid-cols-1 gap-1 text-xs text-subtle sm:grid-cols-2">
                  {Object.entries(d.anthropic.byModel).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, v]) => (
                    <div key={m} className="flex justify-between border-b border-hairline py-1"><span className="truncate pr-2">{m}</span><span className="tabular-nums text-ink">{money(v)}</span></div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-subtle">Suggested voice-LLM = Anthropic total − logged text-LLM − learning (upper bound: also includes other unlogged AI features). Use it to calibrate RATE_VOICE_LLM_PER_MIN.</p>
            </div>
          ) : (
            <div className="mb-6 rounded-xl border border-hairline-strong bg-white p-4 text-sm text-subtle">
              Add an Anthropic <span className="font-medium text-ink">Admin API key</span> as <code>ANTHROPIC_ADMIN_KEY</code> to show real Anthropic spend here. (The standard API key can’t read the cost report.)
            </div>
          )}

          <h2 className="mb-2 text-sm font-semibold text-ink">Per customer</h2>
          <div className="overflow-x-auto rounded-xl border border-hairline-strong bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-subtle">
                  <th className="px-4 py-3 font-medium">Business</th>
                  <th className="px-3 py-3 font-medium text-right">Revenue/mo</th>
                  <th className="px-3 py-3 font-medium text-right">LLM</th>
                  <th className="px-3 py-3 font-medium text-right">Voice</th>
                  <th className="px-3 py-3 font-medium text-right">SMS</th>
                  <th className="px-3 py-3 font-medium text-right">Learning</th>
                  <th className="px-3 py-3 font-medium text-right">Cost</th>
                  <th className="px-3 py-3 font-medium text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {d.customers.map((c) => (
                  <tr key={c.id} className="border-b border-hairline last:border-0 hover:bg-sunken/50">
                    <td className="px-4 py-3"><Link href={`/admin/businesses/${c.id}`} className="font-medium text-ink hover:underline">{c.name || 'Untitled'}</Link><div className="text-xs text-subtle capitalize">{c.plan || '—'}</div></td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">{money(c.revenue)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">{money(c.llm)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">{money(c.voice)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">{money(c.sms)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">{money(c.learning)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-ink">{money(c.cost)}</td>
                    <td className={`px-3 py-3 text-right tabular-nums font-medium ${c.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(c.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-subtle">{d.rates.note} Text-LLM tokens started logging when this shipped (fills in going forward); voice/SMS/learning are computed from existing data.</p>
        </>
      )}
    </div>
  )
}

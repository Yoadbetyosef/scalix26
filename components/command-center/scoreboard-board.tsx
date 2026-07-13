'use client'

import { useCallback, useEffect, useState } from 'react'
import { HealthDot } from '@/components/command-center/ui'
import type { Health } from '@/lib/command-center/types'

interface Item {
  engine: string; metricKey: string; label: string; goalValue: number; actualValue: number | null; notes: string | null; owner: string | null
  scored: { variance: number; attainment: number; status: Health; trend: 'up' | 'flat' | 'down' }
}
interface EngineDef { engine: string; metricKey: string; label: string }

const ENGINE_LABEL: Record<string, string> = { direct: 'Direct Sales', affiliate: 'Affiliate', whiteLabel: 'White Label', expansion: 'Expansion' }

export function ScoreboardBoard() {
  const [week, setWeek] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [engines, setEngines] = useState<EngineDef[]>([])
  const [draft, setDraft] = useState<Record<string, { goal: string; actual: string; owner: string; notes: string }>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (w?: string) => {
    const res = await fetch(`/api/admin/command-center/scoreboard${w ? `?week=${w}` : ''}`)
    const j = await res.json()
    setWeek(j.week); setItems(j.items); setEngines(j.engines)
    const d: Record<string, { goal: string; actual: string; owner: string; notes: string }> = {}
    for (const e of j.engines as EngineDef[]) {
      const it = (j.items as Item[]).find((x) => x.engine === e.engine)
      d[e.engine] = { goal: it ? String(it.goalValue) : '', actual: it?.actualValue != null ? String(it.actualValue) : '', owner: it?.owner ?? '', notes: it?.notes ?? '' }
    }
    setDraft(d)
  }, [])
  useEffect(() => { void (async () => { await load() })() }, [load])

  const shiftWeek = (days: number) => { if (!week) return; const d = new Date(week + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); load(d.toISOString().slice(0, 10)) }

  const saveRow = async (engine: string, metricKey: string) => {
    if (!week) return
    setBusy(true)
    const f = draft[engine]
    await fetch('/api/admin/command-center/scoreboard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week, engine, metricKey, goalValue: Number(f.goal || 0), actualValue: f.actual === '' ? null : Number(f.actual), owner: f.owner || null, notes: f.notes || null }),
    })
    await load(week); setBusy(false)
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => shiftWeek(-7)} className="rounded-lg border border-hairline-strong px-2 py-1 text-sm">←</button>
        <span className="text-sm font-medium text-ink">Week of {week ?? '…'}</span>
        <button onClick={() => shiftWeek(7)} className="rounded-lg border border-hairline-strong px-2 py-1 text-sm">→</button>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {engines.map((e) => {
          const it = items.find((x) => x.engine === e.engine)
          const f = draft[e.engine] ?? { goal: '', actual: '', owner: '', notes: '' }
          return (
            <div key={e.engine} className="rounded-xl border border-hairline-strong bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {it && <HealthDot health={it.scored.status} />}
                  <span className="font-semibold text-ink">{ENGINE_LABEL[e.engine] ?? e.engine}</span>
                </div>
                {it && <span className="text-xs text-subtle">{it.scored.trend === 'up' ? '▲' : it.scored.trend === 'down' ? '▼' : '▬'} var {it.scored.variance}</span>}
              </div>
              <div className="mt-2 text-xs text-subtle">{e.label}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-xs text-subtle">Goal<input value={f.goal} onChange={(ev) => setDraft((d) => ({ ...d, [e.engine]: { ...d[e.engine], goal: ev.target.value } }))} type="number" className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
                <label className="text-xs text-subtle">Actual<input value={f.actual} onChange={(ev) => setDraft((d) => ({ ...d, [e.engine]: { ...d[e.engine], actual: ev.target.value } }))} type="number" className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
                <label className="text-xs text-subtle">Owner<input value={f.owner} onChange={(ev) => setDraft((d) => ({ ...d, [e.engine]: { ...d[e.engine], owner: ev.target.value } }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
                <label className="text-xs text-subtle">Notes<input value={f.notes} onChange={(ev) => setDraft((d) => ({ ...d, [e.engine]: { ...d[e.engine], notes: ev.target.value } }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
              </div>
              <button onClick={() => saveRow(e.engine, e.metricKey)} disabled={busy} className="mt-3 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Save</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

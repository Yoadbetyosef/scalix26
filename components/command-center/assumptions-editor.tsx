'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { runForecast } from '@/lib/command-center/engine'
import { resolveAssumptions } from '@/lib/command-center/resolve'
import { northStar } from '@/lib/command-center/metrics'
import { compactMoney } from '@/lib/command-center/format'

interface Item { category: string; key: string; label: string; unit: string; type: string; value: number; default: number }
interface Section { section: string; items: Item[] }
interface HistoryEntry { id: string; key: string; before: number | null; after: number | null; changedBy: string; changedAt: string }
interface Data { config: { id: string; updatedAt: string; updatedBy: string | null }; sections: Section[]; history: HistoryEntry[] }

const idOf = (i: { category: string; key: string }) => `${i.category}.${i.key}`
const toDisplay = (v: number, t: string) => (t === 'cents' ? String(v / 100) : t === 'pct' ? String(+(v * 100).toFixed(4)) : String(v))
const fromDisplay = (s: string, t: string): number => {
  const n = parseFloat(s); if (!isFinite(n)) return NaN
  return t === 'cents' ? Math.round(n * 100) : t === 'pct' ? n / 100 : t === 'int' ? Math.round(n) : n
}

export function AssumptionsEditor() {
  const [data, setData] = useState<Data | null>(null)
  const [draft, setDraft] = useState<Record<string, number>>({})
  const [saved, setSaved] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/command-center/assumptions')
    const j = await res.json()
    if (!res.ok) { setErr(j.error || 'Failed to load'); return }
    const values: Record<string, number> = {}
    for (const s of j.sections) for (const i of s.items) values[idOf(i)] = i.value
    setData(j); setDraft(values); setSaved(values); setErr(null)
  }, [])
  useEffect(() => { void (async () => { await load() })() }, [load])

  const dirtyKeys = useMemo(() => Object.keys(draft).filter((k) => draft[k] !== saved[k]), [draft, saved])
  const unsaved = dirtyKeys.length > 0

  // Recalculate PREVIEW from the DRAFT — computed entirely inside the engine (no math here).
  const preview = useMemo(() => {
    if (!data) return null
    const rows = Object.entries(draft).map(([id, numeric_value]) => { const [category, key] = id.split('.'); return { category, key, numeric_value } })
    const f = runForecast(resolveAssumptions(rows), 60)
    const ns = northStar(f, 11)
    return { mrr: ns.mrrCents, arr: ns.arrCents, valuation: ns.valuationCents, runway: ns.runwayMonths }
  }, [draft, data])

  const patch = async (body: unknown) => {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/admin/command-center/assumptions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Save failed')
      await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const save = () => patch({ action: 'save', changes: dirtyKeys.map((id) => { const [category, key] = id.split('.'); return { category, key, value: draft[id] } }) })
  const undo = () => setDraft(saved)
  const resetSection = (section: string) => { if (confirm(`Reset "${section}" to defaults?`)) patch({ action: 'resetSection', section }) }
  const resetAll = () => { if (confirm('Reset ALL assumptions to defaults?')) patch({ action: 'resetAll' }) }

  if (err && !data) return <div className="text-sm text-red-600">{err}</div>
  if (!data) return <div className="text-sm text-subtle">Loading…</div>

  return (
    <div className="space-y-6">
      {/* Sticky action bar: unsaved state + preview + save/undo. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-hairline-strong bg-white p-3">
        <div className="text-sm">
          <span className={unsaved ? 'font-semibold text-amber-600' : 'text-subtle'}>{unsaved ? `${dirtyKeys.length} unsaved change${dirtyKeys.length > 1 ? 's' : ''}` : 'All changes saved'}</span>
          <span className="ml-3 text-xs text-subtle">Last modified {new Date(data.config.updatedAt).toLocaleString()} {data.config.updatedBy ? `· ${data.config.updatedBy}` : ''}</span>
        </div>
        {preview && (
          <div className="flex gap-3 text-xs text-subtle">
            <span>Preview (Yr 1): MRR <b className="text-ink">{compactMoney(preview.mrr)}</b></span>
            <span>ARR <b className="text-ink">{compactMoney(preview.arr)}</b></span>
            <span>Valuation <b className="text-ink">{compactMoney(preview.valuation)}</b></span>
            <span>Runway <b className="text-ink">{preview.runway === null ? 'Profitable' : `${preview.runway.toFixed(1)}mo`}</b></span>
          </div>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={undo} disabled={!unsaved || busy} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm disabled:opacity-40">Undo</button>
          <button onClick={save} disabled={!unsaved || busy} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Save changes</button>
          <button onClick={resetAll} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 disabled:opacity-40">Reset all</button>
        </div>
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}

      {data.sections.map((s) => (
        <div key={s.section} className="rounded-xl border border-hairline-strong bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-ink">{s.section}</h3>
            <button onClick={() => resetSection(s.section)} disabled={busy} className="text-xs text-subtle hover:text-ink disabled:opacity-40">Reset section</button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {s.items.map((i) => {
              const id = idOf(i); const dirty = draft[id] !== saved[id]
              return (
                <label key={id} className="block">
                  <span className="text-xs text-subtle">{i.label} <span className="text-subtle/60">({i.unit})</span></span>
                  <input
                    type="number" inputMode="decimal"
                    value={toDisplay(draft[id] ?? i.value, i.type)}
                    onChange={(e) => { const v = fromDisplay(e.target.value, i.type); setDraft((d) => ({ ...d, [id]: Number.isNaN(v) ? d[id] : v })) }}
                    className={`mt-0.5 w-full rounded-lg border px-2 py-1 text-sm tabular-nums ${dirty ? 'border-amber-400 bg-amber-50' : 'border-hairline-strong'}`}
                  />
                  {dirty && <span className="text-[10px] text-subtle">default {toDisplay(i.default, i.type)}</span>}
                </label>
              )
            })}
          </div>
        </div>
      ))}

      {data.history.length > 0 && (
        <div className="rounded-xl border border-hairline-strong bg-white p-4">
          <h3 className="mb-2 font-semibold text-ink">Change history</h3>
          <div className="divide-y divide-hairline text-xs">
            {data.history.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="font-mono text-ink">{h.key}</span>
                <span className="text-subtle">{h.before} → {h.after}</span>
                <span className="ml-auto text-subtle">{new Date(h.changedAt).toLocaleString()} · {h.changedBy}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

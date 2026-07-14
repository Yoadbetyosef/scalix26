'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OperatingPlanRow, PlanLevel } from '@/lib/command-center/operating-plan-store'

const LEVELS: PlanLevel[] = ['annual', 'quarterly', 'monthly', 'weekly', 'daily']
const STATUSES = ['not_started', 'on_track', 'at_risk', 'off_track', 'done']
const S_TONE: Record<string, string> = { not_started: 'bg-gray-100 text-gray-600', on_track: 'bg-emerald-100 text-emerald-700', at_risk: 'bg-amber-100 text-amber-700', off_track: 'bg-red-100 text-red-700', done: 'bg-sky-100 text-sky-700' }
type Row = Record<string, string>
const post = (method: string, body: unknown) => fetch('/api/admin/command-center/operating-plan', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function PlanForm({ d, setD, onSave, onCancel, busy }: { d: Row; setD: (f: (p: Row) => Row) => void; onSave: () => void; onCancel: () => void; busy: boolean }) {
  const F = (k: string, label: string, type = 'text') => <label className="block text-xs text-subtle">{label}<input type={type} value={d[k] ?? ''} onChange={(e) => setD((p) => ({ ...p, [k]: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
  return (
    <div className="rounded-xl border border-hairline-strong bg-sunken/40 p-3">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <label className="block text-xs text-subtle">Level<select value={d.level} onChange={(e) => setD((p) => ({ ...p, level: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm">{LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        {F('objective', 'Objective')}
        {F('owner', 'Owner')}
        <label className="block text-xs text-subtle">Status<select value={d.status} onChange={(e) => setD((p) => ({ ...p, status: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm">{STATUSES.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select></label>
        {F('metricKey', 'Metric key')}
        {F('baseline', 'Baseline')}
        {F('target', 'Target')}
        {F('progress', 'Progress (0-1)')}
        {F('startDate', 'Start date', 'date')}
        {F('dueDate', 'Due date', 'date')}
        <label className="block text-xs text-subtle">Growth engine<select value={d.growthEngine} onChange={(e) => setD((p) => ({ ...p, growthEngine: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm">{['', 'direct', 'affiliate', 'whiteLabel', 'expansion'].map((x) => <option key={x} value={x}>{x || '(none)'}</option>)}</select></label>
        {F('dependencies', 'Dependencies')}
        {F('notes', 'Notes')}
      </div>
      <div className="mt-2 flex gap-2"><button onClick={onSave} disabled={busy || !d.objective} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Save</button><button onClick={onCancel} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm">Cancel</button></div>
    </div>
  )
}

export function OperatingPlanBoard({ rows }: { rows: OperatingPlanRow[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null); const [adding, setAdding] = useState(false)
  const [d, setD] = useState<Row>({}); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const blank = (): Row => ({ level: 'quarterly', objective: '', owner: '', status: 'not_started', metricKey: '', baseline: '', target: '', progress: '0', startDate: '', dueDate: '', growthEngine: '', dependencies: '', notes: '' })
  const toDraft = (r: OperatingPlanRow): Row => ({ level: r.level, objective: r.objective, owner: r.owner ?? '', status: r.status, metricKey: r.metricKey ?? '', baseline: r.baseline == null ? '' : String(r.baseline), target: r.target == null ? '' : String(r.target), progress: String(r.progress), startDate: r.startDate ?? '', dueDate: r.dueDate ?? '', growthEngine: r.growthEngine ?? '', dependencies: r.dependencies ?? '', notes: r.notes ?? '' })
  const num = (s: string) => (s === '' ? null : parseFloat(s))
  const save = async (id: string | null) => {
    setBusy(true); setErr(null)
    try {
      const body = { id, level: d.level, objective: d.objective, owner: d.owner || null, status: d.status, metricKey: d.metricKey || null, baseline: num(d.baseline), target: num(d.target), progress: parseFloat(d.progress) || 0, startDate: d.startDate || null, dueDate: d.dueDate || null, growthEngine: d.growthEngine || null, dependencies: d.dependencies || null, notes: d.notes || null }
      const r = await post('PATCH', body); if (!r.ok) throw new Error((await r.json()).error || 'Save failed')
      setEditing(null); setAdding(false); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const del = async (id: string) => { if (!confirm('Delete this objective?')) return; setBusy(true); try { const r = await post('DELETE', { id }); if (!r.ok) throw new Error('Delete failed'); router.refresh() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const cancel = () => { setEditing(null); setAdding(false) }

  return (
    <div>
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}
      <p className="mb-2 text-xs text-subtle">Mission → annual → quarterly → monthly → weekly → daily. Owned objectives with metric/baseline/target — do not divide annual goals equally by default; set realistic dated targets.</p>
      <div className="mb-3">{adding ? <PlanForm d={d} setD={setD} onSave={() => save(null)} onCancel={cancel} busy={busy} /> : <button onClick={() => { setD(blank()); setAdding(true); setEditing(null) }} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink">+ Add objective</button>}</div>
      {rows.length === 0 && !adding && <div className="rounded-xl border border-dashed border-hairline-strong bg-sunken/40 p-4 text-sm text-subtle">No operating-plan objectives yet.</div>}
      <div className="space-y-2">
        {LEVELS.filter((lvl) => rows.some((r) => r.level === lvl)).map((lvl) => (
          <div key={lvl}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">{lvl}</div>
            <div className="space-y-2">
              {rows.filter((r) => r.level === lvl).map((r) => (
                <div key={r.id} className="rounded-xl border border-hairline-strong bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${S_TONE[r.status]}`}>{r.status.replace(/_/g, ' ')}</span>
                    <span className="font-medium text-ink">{r.objective}</span>
                    {r.owner && <span className="text-xs text-subtle">· {r.owner}</span>}
                    {r.dueDate && <span className="text-xs text-subtle">· due {r.dueDate}</span>}
                    <span className="text-xs text-subtle">· {Math.round(r.progress * 100)}%</span>
                    <span className="ml-auto flex gap-2"><button onClick={() => { setD(toDraft(r)); setEditing(editing === r.id ? null : r.id); setAdding(false) }} className="text-xs text-ink underline">{editing === r.id ? 'Close' : 'Edit'}</button><button onClick={() => del(r.id)} className="text-xs text-red-600 underline">Delete</button></span>
                  </div>
                  {editing === r.id && <div className="mt-2"><PlanForm d={d} setD={setD} onSave={() => save(r.id)} onCancel={cancel} busy={busy} /></div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

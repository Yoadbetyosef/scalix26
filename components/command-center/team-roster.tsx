'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DEPARTMENTS, DRIVERS, type RoleWorkload, type CapacityStatus } from '@/lib/command-center/capacity-v2'

const STATUS_TONE: Record<CapacityStatus, string> = { under: 'bg-sky-100 text-sky-700', healthy: 'bg-emerald-100 text-emerald-700', near: 'bg-amber-100 text-amber-700', overloaded: 'bg-red-100 text-red-700', unknown: 'bg-gray-100 text-gray-500' }
const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
type Draft = { id?: string; department: string; role: string; currentHeadcount: string; plannedHeadcount: string; monthlySalary: string; commission: string; payrollBurdenPct: string; startDate: string; capacityDriver: string; capacityPerEmployee: string; targetUtilization: string; notes: string }
const blank: Draft = { department: 'support', role: '', currentHeadcount: '1', plannedHeadcount: '1', monthlySalary: '0', commission: '0', payrollBurdenPct: '0.2', startDate: '', capacityDriver: 'manual', capacityPerEmployee: '0', targetUtilization: '0.8', notes: '' }

// Module-level so its identity is stable across renders (a component defined inside render remounts every
// keystroke and drops input focus).
function RoleForm({ draft, setDraft, onSave, onCancel, onDelete, busy }: { draft: Draft; setDraft: (f: (d: Draft) => Draft) => void; onSave: () => void; onCancel: () => void; onDelete: (id: string) => void; busy: boolean }) {
  return (
    <div className="rounded-xl border border-hairline-strong bg-sunken/40 p-3">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <label className="block text-xs text-subtle">Department<select value={draft.department} onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm">{DEPARTMENTS.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select></label>
        <label className="block text-xs text-subtle">Role<input value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
        <label className="block text-xs text-subtle">Capacity driver<select value={draft.capacityDriver} onChange={(e) => setDraft((d) => ({ ...d, capacityDriver: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm">{DRIVERS.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select></label>
        {([['currentHeadcount', 'Current headcount'], ['plannedHeadcount', 'Planned headcount'], ['monthlySalary', 'Monthly salary ($)'], ['commission', 'Commission ($/mo)'], ['payrollBurdenPct', 'Payroll burden (0-1)'], ['capacityPerEmployee', 'Capacity / employee'], ['targetUtilization', 'Target utilization (0-1)'], ['startDate', 'Start date']] as const).map(([k, label]) => (
          <label key={k} className="block text-xs text-subtle">{label}<input type={k === 'startDate' ? 'date' : 'text'} value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={onSave} disabled={busy || !draft.role} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Save</button>
        <button onClick={onCancel} disabled={busy} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm">Cancel</button>
        {draft.id && <button onClick={() => onDelete(draft.id!)} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600">Delete</button>}
      </div>
    </div>
  )
}

export function TeamRoster({ workloads }: { workloads: RoleWorkload[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(blank)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const toDraft = (w: RoleWorkload): Draft => ({ id: w.role.id, department: w.role.department, role: w.role.role, currentHeadcount: String(w.role.currentHeadcount), plannedHeadcount: String(w.role.plannedHeadcount), monthlySalary: String(w.role.monthlySalaryCents / 100), commission: String(w.role.commissionCents / 100), payrollBurdenPct: String(w.role.payrollBurdenPct), startDate: w.role.startDate ?? '', capacityDriver: w.role.capacityDriver, capacityPerEmployee: String(w.role.capacityPerEmployee), targetUtilization: String(w.role.targetUtilization), notes: w.role.notes ?? '' })

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const body = {
        id: draft.id ?? null, department: draft.department, role: draft.role,
        currentHeadcount: parseInt(draft.currentHeadcount) || 0, plannedHeadcount: parseInt(draft.plannedHeadcount) || 0,
        monthlySalaryCents: Math.round((parseFloat(draft.monthlySalary) || 0) * 100), commissionCents: Math.round((parseFloat(draft.commission) || 0) * 100),
        payrollBurdenPct: parseFloat(draft.payrollBurdenPct) || 0, startDate: draft.startDate || null,
        capacityDriver: draft.capacityDriver, capacityPerEmployee: parseFloat(draft.capacityPerEmployee) || 0, targetUtilization: parseFloat(draft.targetUtilization) || 0.8, notes: draft.notes || null,
      }
      const res = await fetch('/api/admin/command-center/team-role', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Save failed')
      setEditing(null); setAdding(false); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const del = async (id: string) => {
    if (!confirm('Delete this role?')) return
    setBusy(true)
    try { const res = await fetch('/api/admin/command-center/team-role', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); if (!res.ok) throw new Error('Delete failed'); router.refresh() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const cancel = () => { setEditing(null); setAdding(false) }

  return (
    <div>
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}
      <div className="mb-3">{adding ? <RoleForm draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} onDelete={del} busy={busy} /> : <button onClick={() => { setDraft(blank); setAdding(true); setEditing(null) }} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink">+ Add role</button>}</div>
      {workloads.length === 0 && !adding && <div className="rounded-xl border border-dashed border-hairline-strong bg-sunken/40 p-4 text-sm text-subtle">Manual Input Required — add roles to plan capacity against real demand.</div>}
      <div className="space-y-2">
        {workloads.map((w) => (
          <div key={w.role.id} className="rounded-xl border border-hairline-strong bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${STATUS_TONE[w.status]}`}>{w.status}</span>
              <span className="font-semibold text-ink">{w.role.role}</span>
              <span className="text-xs text-subtle capitalize">{w.role.department.replace(/_/g, ' ')} · {w.role.currentHeadcount} FTE · {money(w.fullyLoadedMonthlyCents)}/mo loaded</span>
              <button onClick={() => { setDraft(toDraft(w)); setEditing(w.role.id); setAdding(false) }} className="ml-auto text-xs text-ink underline">{editing === w.role.id ? 'Close' : 'Edit'}</button>
            </div>
            <div className="mt-1 text-xs text-subtle">
              Driver: {w.driverLabel}{' · '}Demand: {w.demandAvailable ? Math.round(w.demandUnits!) : 'Waiting for Data'}{' · '}Capacity: {Math.round(w.rawCapacity)}{' · '}Utilization: {w.utilization == null ? '—' : `${Math.round(w.utilization * 100)}%`}{w.backlog > 0 ? ` · Backlog: ${Math.round(w.backlog)}` : ''}
            </div>
            {w.recommendation && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <span className="font-semibold">Hire recommended:</span> {w.recommendation.why}. Gap ≈ {w.recommendation.gapUnits} {w.driverLabel}. Cost {money(w.recommendation.monthlyCostCents)}/mo. {w.recommendation.serviceImpact}.
              </div>
            )}
            {editing === w.role.id && <div className="mt-2"><RoleForm draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} onDelete={del} busy={busy} /></div>}
          </div>
        ))}
      </div>
    </div>
  )
}

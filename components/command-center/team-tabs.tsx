'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DEPARTMENTS, DRIVERS, PERIODS, HIRING_STATUSES, type RoleWorkload, type HeadcountView, type HiringPlanRole, type CapacityModel, type CapacityStatus } from '@/lib/command-center/capacity-v2'

const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const STATUS_TONE: Record<CapacityStatus, string> = { under: 'bg-sky-100 text-sky-700', healthy: 'bg-emerald-100 text-emerald-700', near: 'bg-amber-100 text-amber-700', overloaded: 'bg-red-100 text-red-700', unknown: 'bg-gray-100 text-gray-500' }
type Row = Record<string, string>
const post = (url: string, method: string, body: unknown) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function Txt({ label, v, on, type = 'text' }: { label: string; v: string; on: (s: string) => void; type?: string }) {
  return <label className="block text-xs text-subtle">{label}<input type={type} value={v} onChange={(e) => on(e.target.value)} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
}
function Sel({ label, v, on, opts }: { label: string; v: string; on: (s: string) => void; opts: readonly string[] }) {
  return <label className="block text-xs text-subtle">{label}<select value={v} onChange={(e) => on(e.target.value)} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm">{opts.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}</select></label>
}

export function TeamTabs({ workloads, headcount, plan, models }: { workloads: RoleWorkload[]; headcount: HeadcountView; plan: HiringPlanRole[]; models: CapacityModel[] }) {
  const [tab, setTab] = useState<'reality' | 'plan' | 'config'>('reality')
  const tabs: [typeof tab, string][] = [['reality', 'Team Reality'], ['plan', 'Hiring Plan'], ['config', 'Capacity Model']]
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase tracking-wide text-subtle">Reality headcount</div><div className="text-xl font-bold text-ink">{headcount.realityHeadcount}</div><div className="text-[11px] text-subtle">{money(headcount.realityPayrollCents)}/mo</div></div>
        <div className="rounded-xl border border-dashed border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase tracking-wide text-subtle">Planned adds</div><div className="text-xl font-bold text-violet-600">+{headcount.plannedHeadcount}</div><div className="text-[11px] text-subtle">+{money(headcount.plannedPayrollCents)}/mo</div></div>
        <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase tracking-wide text-subtle">Projected (reality + plan)</div><div className="text-xl font-bold text-ink">{headcount.projectedHeadcount}</div><div className="text-[11px] text-subtle">{money(headcount.projectedPayrollCents)}/mo</div></div>
        <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase tracking-wide text-subtle">Hires recommended</div><div className="text-xl font-bold text-amber-600">{workloads.filter((w) => w.recommendation).length}</div><div className="text-[11px] text-subtle">from real demand gaps</div></div>
      </div>
      <div className="mb-4 flex gap-1 border-b border-hairline">
        {tabs.map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm ${tab === k ? 'border-b-2 border-ink font-medium text-ink' : 'text-subtle hover:text-ink'}`}>{label}</button>)}
      </div>
      {tab === 'reality' && <RealityPanel workloads={workloads} models={models} />}
      {tab === 'plan' && <PlanPanel plan={plan} models={models} />}
      {tab === 'config' && <ConfigPanel models={models} />}
    </div>
  )
}

// ── Team Reality ───────────────────────────────────────────────────────────────────────────────────────
function RealityForm({ d, setD, models, onSave, onCancel, busy }: { d: Row; setD: (f: (p: Row) => Row) => void; models: CapacityModel[]; onSave: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <div className="rounded-xl border border-hairline-strong bg-sunken/40 p-3">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Sel label="Department" v={d.department} on={(x) => setD((p) => ({ ...p, department: x }))} opts={DEPARTMENTS} />
        <Txt label="Role" v={d.role} on={(x) => setD((p) => ({ ...p, role: x }))} />
        <label className="block text-xs text-subtle">Capacity model<select value={d.capacityModelId} onChange={(e) => setD((p) => ({ ...p, capacityModelId: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm"><option value="">(none)</option>{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <Txt label="Current headcount" v={d.currentHeadcount} on={(x) => setD((p) => ({ ...p, currentHeadcount: x }))} />
        <Txt label="Base salary ($/mo per emp)" v={d.monthlySalary} on={(x) => setD((p) => ({ ...p, monthlySalary: x }))} />
        <Txt label="Commission ($/mo per emp)" v={d.commission} on={(x) => setD((p) => ({ ...p, commission: x }))} />
        <Txt label="Payroll burden (0-1)" v={d.payrollBurdenPct} on={(x) => setD((p) => ({ ...p, payrollBurdenPct: x }))} />
        <Txt label="Notes" v={d.notes} on={(x) => setD((p) => ({ ...p, notes: x }))} />
      </div>
      <div className="mt-2 flex gap-2"><button onClick={onSave} disabled={busy || !d.role} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Save</button><button onClick={onCancel} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm">Cancel</button></div>
    </div>
  )
}

function RealityPanel({ workloads, models }: { workloads: RoleWorkload[]; models: CapacityModel[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [d, setD] = useState<Row>({})
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const modelName = (id: string | null) => models.find((m) => m.id === id)?.label ?? '—'

  const blank = () => ({ department: 'support', role: '', currentHeadcount: '1', monthlySalary: '0', commission: '0', payrollBurdenPct: '0.2', capacityModelId: '', notes: '' })
  const openEdit = (w: RoleWorkload) => { setEditing(w.role.id); setAdding(false); setD({ department: w.role.department, role: w.role.role, currentHeadcount: String(w.role.currentHeadcount), monthlySalary: String(w.role.monthlySalaryCents / 100), commission: String(w.role.commissionCents / 100), payrollBurdenPct: String(w.role.payrollBurdenPct), capacityModelId: w.role.capacityModelId ?? '', notes: w.role.notes ?? '' }) }
  const save = async (id: string | null) => {
    setBusy(true); setErr(null)
    try {
      const body = { id, department: d.department, role: d.role, currentHeadcount: parseInt(d.currentHeadcount) || 0, monthlySalaryCents: Math.round((parseFloat(d.monthlySalary) || 0) * 100), commissionCents: Math.round((parseFloat(d.commission) || 0) * 100), payrollBurdenPct: parseFloat(d.payrollBurdenPct) || 0, capacityModelId: d.capacityModelId || null, notes: d.notes || null }
      const r = await post('/api/admin/command-center/team-reality', 'PATCH', body); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Save failed')
      setEditing(null); setAdding(false); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const close = async (id: string) => { if (!confirm('Close this role (soft; history preserved)?')) return; setBusy(true); try { const r = await post('/api/admin/command-center/team-reality', 'DELETE', { id }); if (!r.ok) throw new Error('Close failed'); router.refresh() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const cancel = () => { setEditing(null); setAdding(false) }

  return (
    <div>
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}
      <div className="mb-3">{adding ? <RealityForm d={d} setD={setD} models={models} onSave={() => save(null)} onCancel={cancel} busy={busy} /> : <button onClick={() => { setD(blank()); setAdding(true); setEditing(null) }} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink">+ Add current role</button>}</div>
      {workloads.length === 0 && !adding && <div className="rounded-xl border border-dashed border-hairline-strong bg-sunken/40 p-4 text-sm text-subtle">Manual Input Required — add the current organization. Reality shows only who is on the team today.</div>}
      <div className="space-y-2">
        {workloads.map((w) => (
          <div key={w.role.id} className="rounded-xl border border-hairline-strong bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${STATUS_TONE[w.status]}`}>{w.status}</span>
              <span className="font-semibold text-ink">{w.role.role}</span>
              <span className="text-xs text-subtle capitalize">{w.role.department.replace(/_/g, ' ')} · {w.role.currentHeadcount} FTE · {money(w.fullyLoadedMonthlyCents)}/mo · model: {modelName(w.role.capacityModelId)}</span>
              <span className="ml-auto flex gap-2"><button onClick={() => (editing === w.role.id ? setEditing(null) : openEdit(w))} className="text-xs text-ink underline">{editing === w.role.id ? 'Close' : 'Edit'}</button><button onClick={() => close(w.role.id)} className="text-xs text-red-600 underline">Retire</button></span>
            </div>
            <div className="mt-1 text-xs text-subtle">Demand: {w.demandAvailable ? Math.round(w.demandNormalized!) : 'Waiting for Data'} · Capacity: {Math.round(w.capacity)} · Utilization: {w.utilization == null ? '—' : `${Math.round(w.utilization * 100)}%`}{w.backlog > 0 ? ` · Backlog: ${Math.round(w.backlog)}` : ''}</div>
            {w.recommendation && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><span className="font-semibold">Hire recommended:</span> {w.recommendation.why}. Gap ≈ {w.recommendation.gapUnits} {w.recommendation.unit}. Cost {money(w.recommendation.monthlyCostCents)}/mo. {w.recommendation.serviceImpact}.</div>}
            {editing === w.role.id && <div className="mt-2"><RealityForm d={d} setD={setD} models={models} onSave={() => save(w.role.id)} onCancel={cancel} busy={busy} /></div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Hiring Plan ────────────────────────────────────────────────────────────────────────────────────────
function PlanForm({ d, setD, models, onSave, onCancel, busy }: { d: Row; setD: (f: (p: Row) => Row) => void; models: CapacityModel[]; onSave: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <div className="rounded-xl border border-hairline-strong bg-sunken/40 p-3">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Sel label="Department" v={d.department} on={(x) => setD((p) => ({ ...p, department: x }))} opts={DEPARTMENTS} />
        <Txt label="Role" v={d.role} on={(x) => setD((p) => ({ ...p, role: x }))} />
        <Txt label="Headcount" v={d.headcount} on={(x) => setD((p) => ({ ...p, headcount: x }))} />
        <Txt label="Planned start" v={d.plannedStartDate} on={(x) => setD((p) => ({ ...p, plannedStartDate: x }))} type="date" />
        <Txt label="Base salary ($/mo per emp)" v={d.monthlySalary} on={(x) => setD((p) => ({ ...p, monthlySalary: x }))} />
        <Txt label="Commission ($/mo per emp)" v={d.commission} on={(x) => setD((p) => ({ ...p, commission: x }))} />
        <Txt label="Payroll burden (0-1)" v={d.payrollBurdenPct} on={(x) => setD((p) => ({ ...p, payrollBurdenPct: x }))} />
        <label className="block text-xs text-subtle">Capacity model<select value={d.capacityModelId} onChange={(e) => setD((p) => ({ ...p, capacityModelId: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm"><option value="">(none)</option>{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <Sel label="Priority" v={d.priority} on={(x) => setD((p) => ({ ...p, priority: x }))} opts={['', 'low', 'medium', 'high']} />
        <Sel label="Status" v={d.status} on={(x) => setD((p) => ({ ...p, status: x }))} opts={HIRING_STATUSES} />
        <Sel label="Growth engine" v={d.growthEngine} on={(x) => setD((p) => ({ ...p, growthEngine: x }))} opts={['', 'direct', 'affiliate', 'whiteLabel', 'expansion']} />
        <Txt label="Hiring reason" v={d.hiringReason} on={(x) => setD((p) => ({ ...p, hiringReason: x }))} />
      </div>
      <div className="mt-2 flex gap-2"><button onClick={onSave} disabled={busy || !d.role} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Save</button><button onClick={onCancel} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm">Cancel</button></div>
    </div>
  )
}

function PlanPanel({ plan, models }: { plan: HiringPlanRole[]; models: CapacityModel[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null); const [adding, setAdding] = useState(false)
  const [d, setD] = useState<Row>({}); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const blank = () => ({ department: 'engineering', role: '', headcount: '1', plannedStartDate: '', monthlySalary: '0', commission: '0', payrollBurdenPct: '0.2', capacityModelId: '', hiringReason: '', growthEngine: '', priority: 'medium', status: 'proposed', notes: '' })
  const openEdit = (h: HiringPlanRole) => { setEditing(h.id); setAdding(false); setD({ department: h.department, role: h.role, headcount: String(h.headcount), plannedStartDate: h.plannedStartDate ?? '', monthlySalary: String(h.monthlySalaryCents / 100), commission: String(h.commissionCents / 100), payrollBurdenPct: String(h.payrollBurdenPct), capacityModelId: h.capacityModelId ?? '', hiringReason: h.hiringReason ?? '', growthEngine: h.growthEngine ?? '', priority: h.priority ?? '', status: h.status, notes: h.notes ?? '' }) }
  const save = async (id: string | null) => {
    setBusy(true); setErr(null)
    try {
      const body = { id, department: d.department, role: d.role, headcount: parseInt(d.headcount) || 1, plannedStartDate: d.plannedStartDate || null, monthlySalaryCents: Math.round((parseFloat(d.monthlySalary) || 0) * 100), commissionCents: Math.round((parseFloat(d.commission) || 0) * 100), payrollBurdenPct: parseFloat(d.payrollBurdenPct) || 0, capacityModelId: d.capacityModelId || null, hiringReason: d.hiringReason || null, growthEngine: d.growthEngine || null, priority: d.priority || null, status: d.status, notes: d.notes || null }
      const r = await post('/api/admin/command-center/hiring-plan', 'PATCH', body); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Save failed')
      setEditing(null); setAdding(false); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const del = async (id: string) => { if (!confirm('Delete this planned hire?')) return; setBusy(true); try { const r = await post('/api/admin/command-center/hiring-plan', 'DELETE', { id }); if (!r.ok) throw new Error('Delete failed'); router.refresh() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const move = async (id: string) => { if (!confirm('Move this hire into Team Reality? This adds a current role and marks the plan hired.')) return; setBusy(true); try { const r = await post('/api/admin/command-center/hiring-plan', 'POST', { action: 'move_to_reality', id }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Move failed'); router.refresh() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const cancel = () => { setEditing(null); setAdding(false) }

  return (
    <div>
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}
      <p className="mb-2 text-xs text-subtle">Future hires only. Planned payroll never counts as current payroll. A hire becomes reality only via the explicit <span className="font-medium">Move to Team Reality</span> action.</p>
      <div className="mb-3">{adding ? <PlanForm d={d} setD={setD} models={models} onSave={() => save(null)} onCancel={cancel} busy={busy} /> : <button onClick={() => { setD(blank()); setAdding(true); setEditing(null) }} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink">+ Add planned hire</button>}</div>
      {plan.length === 0 && !adding && <div className="rounded-xl border border-dashed border-hairline-strong bg-sunken/40 p-4 text-sm text-subtle">No planned hires.</div>}
      <div className="space-y-2">
        {plan.map((h) => (
          <div key={h.id} className="rounded-xl border border-hairline-strong bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-violet-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-violet-700">{h.status.replace(/_/g, ' ')}</span>
              <span className="font-semibold text-ink">{h.role}</span>
              <span className="text-xs text-subtle capitalize">{h.department.replace(/_/g, ' ')} · {h.headcount} · start {h.plannedStartDate ?? '—'} · {h.priority ?? 'no'} priority{h.growthEngine ? ` · ${h.growthEngine}` : ''}</span>
              <span className="ml-auto flex gap-2">
                {h.status !== 'hired' && <button onClick={() => move(h.id)} disabled={busy} className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white">Move to Reality</button>}
                <button onClick={() => (editing === h.id ? setEditing(null) : openEdit(h))} className="text-xs text-ink underline">{editing === h.id ? 'Close' : 'Edit'}</button>
                <button onClick={() => del(h.id)} className="text-xs text-red-600 underline">Delete</button>
              </span>
            </div>
            {h.hiringReason && <div className="mt-1 text-xs text-subtle">{h.hiringReason}</div>}
            {editing === h.id && <div className="mt-2"><PlanForm d={d} setD={setD} models={models} onSave={() => save(h.id)} onCancel={cancel} busy={busy} /></div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Capacity Model (config) ────────────────────────────────────────────────────────────────────────────
function ConfigPanel({ models }: { models: CapacityModel[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const [d, setD] = useState<Row>({}); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const openEdit = (m: CapacityModel) => { setEditing(m.id); setD({ label: m.label, capacityDriver: m.capacityDriver, capacityPerEmployee: String(m.capacityPerEmployee), capacityUnit: m.capacityUnit, capacityPeriod: m.capacityPeriod, targetUtilization: String(m.targetUtilization), demandMetricKey: m.demandMetricKey ?? '' }) }
  const save = async (id: string) => {
    setBusy(true); setErr(null)
    try {
      const body = { id, label: d.label, capacityDriver: d.capacityDriver, capacityPerEmployee: parseFloat(d.capacityPerEmployee) || 0, capacityUnit: d.capacityUnit, capacityPeriod: d.capacityPeriod, targetUtilization: parseFloat(d.targetUtilization) || 0.8, demandMetricKey: d.demandMetricKey || null }
      const r = await post('/api/admin/command-center/capacity-model', 'PATCH', body); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Save failed')
      setEditing(null); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div>
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}
      <p className="mb-2 text-xs text-subtle">Configuration only — capacity assumptions per role type, versioned by effective date. Editing closes the prior version and creates a new one (never a silent overwrite).</p>
      <div className="space-y-2">
        {models.map((m) => (
          <div key={m.id} className="rounded-xl border border-hairline-strong bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{m.label}</span>
              <span className="text-xs text-subtle">{m.capacityPerEmployee} {m.capacityUnit} / {m.capacityDriver === 'support_hours' || m.capacityDriver === 'sales_opportunities' ? m.capacityPeriod : 'at a time'} · driver {m.capacityDriver.replace(/_/g, ' ')} · target {Math.round(m.targetUtilization * 100)}%</span>
              <button onClick={() => (editing === m.id ? setEditing(null) : openEdit(m))} className="ml-auto text-xs text-ink underline">{editing === m.id ? 'Close' : 'Edit'}</button>
            </div>
            {editing === m.id && (
              <div className="mt-2 rounded-xl border border-hairline-strong bg-sunken/40 p-3">
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  <Txt label="Label" v={d.label} on={(x) => setD((p) => ({ ...p, label: x }))} />
                  <Sel label="Driver" v={d.capacityDriver} on={(x) => setD((p) => ({ ...p, capacityDriver: x }))} opts={DRIVERS} />
                  <Txt label="Capacity / employee" v={d.capacityPerEmployee} on={(x) => setD((p) => ({ ...p, capacityPerEmployee: x }))} />
                  <Txt label="Unit" v={d.capacityUnit} on={(x) => setD((p) => ({ ...p, capacityUnit: x }))} />
                  <Sel label="Period" v={d.capacityPeriod} on={(x) => setD((p) => ({ ...p, capacityPeriod: x }))} opts={PERIODS} />
                  <Txt label="Target utilization (0-1)" v={d.targetUtilization} on={(x) => setD((p) => ({ ...p, targetUtilization: x }))} />
                  <Txt label="Demand metric key" v={d.demandMetricKey} on={(x) => setD((p) => ({ ...p, demandMetricKey: x }))} />
                </div>
                <div className="mt-2 flex gap-2"><button onClick={() => save(m.id)} disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Save new version</button><button onClick={() => setEditing(null)} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm">Cancel</button></div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

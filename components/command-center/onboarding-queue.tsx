'use client'

import { useMemo, useState } from 'react'
import { filterQueue, sortQueue, isOutsideSla, BLOCKERS, PRIORITIES, type OnboardingCase, type QueueFilters, type OverlayPatch } from '@/lib/command-center/queue-logic'

const STAGE_LABEL: Record<string, string> = { signed_up: 'Signed up', payment_complete: 'Payment', setup_complete: 'Setup', technically_live: 'Live', activated: 'Activated', adopted: 'Adopted' }
const money = (c: number) => (c > 0 ? `$${(c / 100).toFixed(0)}` : '—')

export function OnboardingQueue({ cases }: { cases: OnboardingCase[] }) {
  const [nowMs] = useState(() => Date.now()) // client clock, stable for the session; keeps server render pure
  const [list, setList] = useState(cases)
  const [filters, setFilters] = useState<QueueFilters>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<OverlayPatch>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const shown = useMemo(() => sortQueue(filterQueue(list, filters, nowMs), nowMs), [list, filters, nowMs])
  const toggle = (k: 'stalled' | 'outsideSla' | 'highPriority' | 'unassigned') => setFilters((f) => ({ ...f, [k]: f[k] ? undefined : true }))

  const startEdit = (c: OnboardingCase) => {
    setEditing(c.tenantId); setErr(null)
    setDraft({ owner: c.overlay?.owner ?? '', manualStage: c.overlay?.manualStage ?? '', blocker: c.overlay?.blocker ?? null, blockerNotes: c.overlay?.blockerNotes ?? '', slaDueDate: c.overlay?.slaDueDate ?? '', priority: c.overlay?.priority ?? null, nextAction: c.overlay?.nextAction ?? '', followUpDate: c.overlay?.followUpDate ?? '', status: c.overlay?.status ?? '', resolutionNote: c.overlay?.resolutionNote ?? '' })
  }
  const clean = (p: OverlayPatch): OverlayPatch => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === '' ? null : v])) as OverlayPatch

  const save = async (tenantId: string) => {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/admin/command-center/onboarding-overlay', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...clean(draft) }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Save failed')
      setList((l) => l.map((c) => (c.tenantId === tenantId ? { ...c, overlay: j.overlay } : c))) // only after confirmed save
      setEditing(null)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const clear = async (tenantId: string) => {
    if (!confirm('Clear the operational overlay for this account?')) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/command-center/onboarding-overlay', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId }) })
      if (!res.ok) throw new Error('Clear failed')
      setList((l) => l.map((c) => (c.tenantId === tenantId ? { ...c, overlay: null } : c)))
      setEditing(null)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const Field = ({ label, k, type = 'text' }: { label: string; k: keyof OverlayPatch; type?: string }) => (
    <label className="block text-xs text-subtle">{label}
      <input type={type} value={(draft[k] as string) ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" />
    </label>
  )

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {(['outsideSla', 'stalled', 'highPriority', 'unassigned'] as const).map((k) => (
          <button key={k} onClick={() => toggle(k)} className={`rounded-full border px-2.5 py-1 ${filters[k] ? 'border-ink bg-ink text-white' : 'border-hairline-strong text-subtle'}`}>{k === 'outsideSla' ? 'Outside SLA' : k === 'highPriority' ? 'High priority' : k[0].toUpperCase() + k.slice(1)}</button>
        ))}
        <select value={filters.blocker ?? ''} onChange={(e) => setFilters((f) => ({ ...f, blocker: e.target.value || undefined }))} className="rounded border border-hairline-strong px-2 py-1">
          <option value="">Any blocker</option>{BLOCKERS.map((b) => <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={filters.engine ?? ''} onChange={(e) => setFilters((f) => ({ ...f, engine: (e.target.value || undefined) as QueueFilters['engine'] }))} className="rounded border border-hairline-strong px-2 py-1">
          <option value="">Any engine</option><option value="direct">Direct</option><option value="affiliate">Affiliate</option><option value="whiteLabel">White Label</option>
        </select>
        <span className="text-subtle">{shown.length} accounts</span>
      </div>
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}

      <div className="overflow-x-auto rounded-xl border border-hairline-strong">
        <table className="min-w-full text-sm">
          <thead className="bg-sunken text-subtle"><tr>{['Customer', 'Observed', 'Manual stage', 'Days', 'MRR', 'SLA', 'Priority', 'Blocker', 'Owner', ''].map((h) => <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-hairline">
            {shown.map((c) => (
              <>
                <tr key={c.tenantId} className={isOutsideSla(c, nowMs) ? 'bg-red-50/40' : ''}>
                  <td className="px-3 py-2 font-medium text-ink whitespace-nowrap">{c.name}</td>
                  <td className="px-3 py-2"><span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700">{STAGE_LABEL[c.observedStage] ?? c.observedStage}</span></td>
                  <td className="px-3 py-2 text-subtle">{c.overlay?.manualStage || '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{c.daysInOnboarding}</td>
                  <td className="px-3 py-2 tabular-nums">{money(c.mrrCents)}</td>
                  <td className="px-3 py-2">{c.overlay?.slaDueDate ? <span className={isOutsideSla(c, nowMs) ? 'text-red-600' : 'text-subtle'}>{c.overlay.slaDueDate}</span> : '—'}</td>
                  <td className="px-3 py-2 capitalize">{c.overlay?.priority ?? '—'}</td>
                  <td className="px-3 py-2 text-subtle">{c.overlay?.blocker?.replace(/_/g, ' ') ?? '—'}</td>
                  <td className="px-3 py-2 text-subtle">{c.overlay?.owner ?? '—'}</td>
                  <td className="px-3 py-2"><button onClick={() => (editing === c.tenantId ? setEditing(null) : startEdit(c))} className="text-xs text-ink underline">{editing === c.tenantId ? 'Close' : 'Edit'}</button></td>
                </tr>
                {editing === c.tenantId && (
                  <tr key={c.tenantId + '-edit'}><td colSpan={10} className="bg-sunken px-3 py-3">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Owner" k="owner" />
                      <Field label="Manual stage (does not change observed)" k="manualStage" />
                      <label className="block text-xs text-subtle">Blocker
                        <select value={(draft.blocker as string) ?? ''} onChange={(e) => setDraft((d) => ({ ...d, blocker: (e.target.value || null) as OverlayPatch['blocker'] }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm">
                          <option value="">None</option>{BLOCKERS.map((b) => <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>)}
                        </select>
                      </label>
                      <label className="block text-xs text-subtle">Priority
                        <select value={(draft.priority as string) ?? ''} onChange={(e) => setDraft((d) => ({ ...d, priority: (e.target.value || null) as OverlayPatch['priority'] }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm">
                          <option value="">None</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </label>
                      <Field label="Blocker notes" k="blockerNotes" />
                      <Field label="SLA due date" k="slaDueDate" type="date" />
                      <Field label="Next action" k="nextAction" />
                      <Field label="Follow-up date" k="followUpDate" type="date" />
                      <Field label="Status" k="status" />
                      <Field label="Resolution note" k="resolutionNote" />
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => save(c.tenantId)} disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Save</button>
                      <button onClick={() => setEditing(null)} disabled={busy} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm">Cancel</button>
                      {c.overlay && <button onClick={() => clear(c.tenantId)} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600">Clear overlay</button>}
                      {c.overlay?.updatedAt && <span className="ml-auto text-[11px] text-subtle">last modified {new Date(c.overlay.updatedAt).toLocaleString()} · {c.overlay.updatedBy}</span>}
                    </div>
                  </td></tr>
                )}
              </>
            ))}
            {shown.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-subtle">No accounts match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

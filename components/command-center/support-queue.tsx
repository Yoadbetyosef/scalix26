'use client'

import { useMemo, useState } from 'react'
import { ISSUE_TYPES, SEVERITIES, type SupportQueueRow, type Severity } from '@/lib/command-center/support-ops'

const SEV_TONE: Record<Severity, string> = { critical: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-gray-100 text-gray-600' }
const CONV_KINDS = new Set(['human_takeover', 'open_conversation', 'message_failure'])
const money = (c: number) => (c > 0 ? `$${(c / 100).toFixed(0)}` : '—')
const dur = (h: number) => (h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`)

// Module-level so its identity is stable across renders (an in-render component remounts each keystroke and drops focus).
function TextField({ label, k, draft, setDraft }: { label: string; k: string; draft: Record<string, string>; setDraft: (f: (d: Record<string, string>) => Record<string, string>) => void }) {
  return (
    <label className="block text-xs text-subtle">{label}
      <input value={draft[k] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" />
    </label>
  )
}

export function SupportQueue({ rows }: { rows: SupportQueueRow[] }) {
  const [list, setList] = useState(rows)
  const [sev, setSev] = useState('')
  const [issue, setIssue] = useState('')
  const [unassigned, setUnassigned] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const shown = useMemo(() => list.filter((r) => (!sev || r.severity === sev) && (!issue || r.issue === issue) && (!unassigned || !r.owner)), [list, sev, issue, unassigned])

  const startEdit = (r: SupportQueueRow) => {
    setEditing(r.signalId); setErr(null)
    setDraft({ owner: r.overlay?.owner ?? '', issueType: r.overlay?.issueType ?? '', severity: r.overlay?.severity ?? '', status: r.overlay?.status ?? '', notes: r.overlay?.notes ?? '', resolutionNote: r.overlay?.resolutionNote ?? '' })
  }
  const save = async (signalId: string) => {
    setBusy(true); setErr(null)
    try {
      const body = { signalId, owner: draft.owner || null, issueType: draft.issueType || null, severity: draft.severity || null, status: draft.status || null, notes: draft.notes || null, resolutionNote: draft.resolutionNote || null }
      const res = await fetch('/api/admin/command-center/support-overlay', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Save failed')
      setList((l) => l.map((r) => (r.signalId === signalId ? { ...r, overlay: j.overlay, owner: j.overlay.owner, issue: j.overlay.issueType || r.issue, severity: j.overlay.severity || r.severity, issueDerived: j.overlay.issueType ? false : r.issueDerived } : r)))
      setEditing(null)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const clear = async (signalId: string) => {
    if (!confirm('Clear the operational overlay for this item?')) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/command-center/support-overlay', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signalId }) })
      if (!res.ok) throw new Error('Clear failed')
      setList((l) => l.map((r) => (r.signalId === signalId ? { ...r, overlay: null, owner: null } : r)))
      setEditing(null)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <select value={sev} onChange={(e) => setSev(e.target.value)} className="rounded border border-hairline-strong px-2 py-1"><option value="">Any severity</option>{SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={issue} onChange={(e) => setIssue(e.target.value)} className="rounded border border-hairline-strong px-2 py-1"><option value="">Any issue</option>{ISSUE_TYPES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>
        <button onClick={() => setUnassigned((v) => !v)} className={`rounded-full border px-2.5 py-1 ${unassigned ? 'border-ink bg-ink text-white' : 'border-hairline-strong text-subtle'}`}>Unassigned</button>
        <span className="text-subtle">{shown.length} items · content never shown here</span>
      </div>
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}
      <div className="overflow-x-auto rounded-xl border border-hairline-strong">
        <table className="min-w-full text-sm">
          <thead className="bg-sunken text-subtle"><tr>{['Severity', 'Customer', 'Plan', 'Issue', 'Open', 'MRR', 'Owner', 'Recommended action', ''].map((h) => <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-hairline">
            {shown.map((r) => (
              <>
                <tr key={r.signalId}>
                  <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEV_TONE[r.severity]}`}>{r.severity}</span></td>
                  <td className="px-3 py-2 font-medium text-ink whitespace-nowrap">{r.name}</td>
                  <td className="px-3 py-2 text-subtle capitalize">{r.plan}</td>
                  <td className="px-3 py-2 text-subtle">{r.issue.replace(/_/g, ' ')}{r.issueDerived && <span className="ml-1 rounded bg-sky-100 px-1 text-[9px] text-sky-700">derived</span>}{r.overlay?.issueType && <span className="ml-1 rounded bg-gray-100 px-1 text-[9px] text-gray-600">manual</span>}</td>
                  <td className="px-3 py-2 tabular-nums text-subtle">{dur(r.openHours)}</td>
                  <td className="px-3 py-2 tabular-nums">{money(r.mrrCents)}</td>
                  <td className="px-3 py-2 text-subtle">{r.owner ?? '—'}</td>
                  <td className="px-3 py-2 text-subtle">{r.recommendedAction}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {CONV_KINDS.has(r.kind) && <a href={`/inbox/${r.signalId}`} target="_blank" rel="noreferrer" className="mr-2 text-xs text-subtle underline">source</a>}
                    <button onClick={() => (editing === r.signalId ? setEditing(null) : startEdit(r))} className="text-xs text-ink underline">{editing === r.signalId ? 'Close' : 'Edit'}</button>
                  </td>
                </tr>
                {editing === r.signalId && (
                  <tr key={r.signalId + '-e'}><td colSpan={9} className="bg-sunken px-3 py-3">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <TextField label="Owner" k="owner" draft={draft} setDraft={setDraft} />
                      <label className="block text-xs text-subtle">Issue type (manual override)
                        <select value={draft.issueType ?? ''} onChange={(e) => setDraft((d) => ({ ...d, issueType: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm"><option value="">(keep derived)</option>{ISSUE_TYPES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>
                      </label>
                      <label className="block text-xs text-subtle">Severity (override)
                        <select value={draft.severity ?? ''} onChange={(e) => setDraft((d) => ({ ...d, severity: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm"><option value="">(keep derived)</option>{SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                      </label>
                      <TextField label="Status" k="status" draft={draft} setDraft={setDraft} />
                      <TextField label="Notes (no customer content)" k="notes" draft={draft} setDraft={setDraft} />
                      <TextField label="Resolution note" k="resolutionNote" draft={draft} setDraft={setDraft} />
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => save(r.signalId)} disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Save</button>
                      <button onClick={() => setEditing(null)} disabled={busy} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm">Cancel</button>
                      {r.overlay && <button onClick={() => clear(r.signalId)} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600">Clear</button>}
                      {r.overlay?.updatedAt && <span className="ml-auto text-[11px] text-subtle">last modified {new Date(r.overlay.updatedAt).toLocaleString()} · {r.overlay.updatedBy}</span>}
                    </div>
                  </td></tr>
                )}
              </>
            ))}
            {shown.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-subtle">No operational items match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

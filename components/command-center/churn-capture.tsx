'use client'

import { useCallback, useEffect, useState } from 'react'

interface Item { id: string; tenant_id: string; primary_reason: string; notes: string | null; save_attempted: boolean; save_outcome: string | null; created_by: string; created_at: string }

export function ChurnCapture() {
  const [reasons, setReasons] = useState<string[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [form, setForm] = useState({ tenantId: '', primaryReason: '', notes: '', saveAttempted: false, saveOutcome: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/command-center/churn-reasons')
    const j = await res.json()
    if (res.ok) { setReasons(j.reasons); setItems(j.items) }
  }, [])
  useEffect(() => { void (async () => { await load() })() }, [load])

  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/admin/command-center/churn-reasons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed')
      setForm({ tenantId: '', primaryReason: '', notes: '', saveAttempted: false, saveOutcome: '' })
      await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-hairline-strong bg-white p-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input value={form.tenantId} onChange={(e) => setForm((f) => ({ ...f, tenantId: e.target.value }))} placeholder="Tenant ID (uuid)" className="rounded border border-hairline-strong px-2 py-1 text-sm" />
        <select value={form.primaryReason} onChange={(e) => setForm((f) => ({ ...f, primaryReason: e.target.value }))} className="rounded border border-hairline-strong px-2 py-1 text-sm">
          <option value="">Primary reason…</option>
          {reasons.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
        </select>
        <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes" className="rounded border border-hairline-strong px-2 py-1 text-sm" />
        <label className="flex items-center gap-1 text-xs text-subtle"><input type="checkbox" checked={form.saveAttempted} onChange={(e) => setForm((f) => ({ ...f, saveAttempted: e.target.checked }))} /> Save attempted</label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={submit} disabled={busy || !form.tenantId || !form.primaryReason} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Record churn reason</button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
      {items.length > 0 && (
        <div className="mt-3 divide-y divide-hairline text-xs">
          {items.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="font-mono text-subtle">{i.tenant_id.slice(0, 8)}</span>
              <span className="font-medium text-ink">{i.primary_reason.replace(/_/g, ' ')}</span>
              {i.save_attempted && <span className="rounded bg-sunken px-1 text-[10px]">save {i.save_outcome || 'attempted'}</span>}
              {i.notes && <span className="text-subtle">— {i.notes}</span>}
              <span className="ml-auto text-subtle">{new Date(i.created_at).toLocaleDateString()} · {i.created_by}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

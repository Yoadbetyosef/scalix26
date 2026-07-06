'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/components/admin/toast'
import type { ModuleState } from '@/lib/modules'

interface Row { key: string; label: string; description: string; state: ModuleState }
interface StateDef { key: ModuleState; label: string; hint: string }

const stateCls: Record<string, string> = {
  enabled: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  beta: 'bg-amber-50 text-amber-700 border-amber-200',
  enterprise: 'bg-violet-50 text-violet-700 border-violet-200',
  disabled: 'bg-red-50 text-red-700 border-red-200',
}

export default function FeatureFlagsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [states, setStates] = useState<StateDef[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const { show, node: toast } = useToast()

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/feature-flags')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setRows(d.modules || []); setStates(d.states || [])
    } catch (e) { show((e as Error).message, 'err') } finally { setLoading(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function setState(key: string, state: ModuleState) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, state } : r)))
    setSaving(key)
    try {
      const res = await fetch('/api/admin/feature-flags', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ module: key, state }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
      show(`${key} → ${state}`)
    } catch (e) { show((e as Error).message, 'err'); load() } finally { setSaving(null) }
  }

  return (
    <div className="max-w-3xl">
      {toast}
      <h1 className="text-2xl font-bold text-ink mb-1">Feature Flags</h1>
      <p className="text-sm text-subtle mb-6">Global lifecycle state per module — applied on top of each business’s own toggle. Changes apply immediately.</p>

      {loading ? <p className="text-sm text-muted">Loading…</p> : (
        <div className="divide-y divide-hairline rounded-xl border border-hairline-strong bg-white">
          {rows.map((r) => (
            <div key={r.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{r.label}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${stateCls[r.state]}`}>{r.state}</span>
                  {saving === r.key && <span className="text-xs text-accent-strong">saving…</span>}
                </div>
                <div className="text-xs text-subtle">{r.description}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                {states.map((s) => (
                  <button
                    key={s.key}
                    title={s.hint}
                    onClick={() => setState(r.key, s.key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${r.state === s.key ? 'bg-ink text-white' : 'border border-hairline-strong text-subtle hover:text-ink'}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

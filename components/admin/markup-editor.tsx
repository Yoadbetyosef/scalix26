'use client'

import { useEffect, useState } from 'react'

interface Override { scope: string; partner_id: string | null; markup_pct: number }

// White Label pricing markup — the single knob that sets partner charge = provider cost × (1 + markup).
// Phase 1: edit the global default. Per-partner overrides are shown read-only (their editor comes later).
export default function MarkupEditor() {
  const [pct, setPct] = useState<string>('')
  const [current, setCurrent] = useState<number | null>(null)
  const [fallback, setFallback] = useState(false)
  const [overrides, setOverrides] = useState<Override[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/admin/billing/markup')
      const d = await res.json()
      if (res.ok) {
        setCurrent(d.globalMarkupPct); setPct(String(d.globalMarkupPct))
        setFallback(!!d.usingFallback); setOverrides(d.overrides || [])
      }
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/billing/markup', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markup_pct: Number(pct) }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to save')
      setCurrent(d.globalMarkupPct); setFallback(false); setMsg('Saved')
    } catch (e) { setMsg((e as Error).message) } finally { setSaving(false) }
  }

  const dirty = current != null && Number(pct) !== current

  return (
    <div className="rounded-xl border border-hairline-strong bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-subtle">Global markup</div>
          <div className="mt-0.5 text-sm text-subtle">Applied to provider cost for every White Label partner charge.</div>
        </div>
        {loading ? <span className="text-sm text-muted">Loading…</span> : (
          <div className="flex items-center gap-2">
            <input type="number" min={0} max={1000} step={0.5} value={pct}
              onChange={(e) => setPct(e.target.value)}
              className="w-24 rounded-lg border border-hairline-strong px-3 py-1.5 text-right text-lg font-semibold text-ink tabular-nums" />
            <span className="text-lg font-semibold text-ink">%</span>
            <button onClick={save} disabled={!dirty || saving}
              className="ml-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
      {fallback && <div className="mt-2 text-xs text-warning">No config row found — using the built-in {current}% default. Save to persist.</div>}
      {msg && <div className="mt-2 text-xs text-subtle">{msg}</div>}
      {overrides.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-2 text-xs text-subtle">
          {overrides.length} per-partner override{overrides.length > 1 ? 's' : ''} active (managed via API for now).
        </div>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Building2, ArrowLeft, ArrowLeftRight, Loader2, Search, X, Check } from 'lucide-react'

type Business = { tenant_id: string | null; business_name: string; status: string }

// Shown at the top of the business app when a White Label partner is OPERATING a client workspace.
// Keeps the partner oriented (which business) and one tap from switching or returning to their console.
export function OperatorBar({ businessName }: { businessName: string | null }) {
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Exit operator mode (clears active_ws), then go to the company console.
  async function backToCompany() {
    setBusy(true)
    await fetch('/api/partner/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'exit' }) }).catch(() => {})
    window.location.href = '/partner'
  }

  return (
    <>
      <div className="sticky top-0 z-50 flex items-center justify-between gap-2 bg-accent px-4 py-2 text-sm text-white">
        <span className="inline-flex min-w-0 items-center gap-2">
          <Building2 className="h-4 w-4 shrink-0" />
          <span className="truncate">Operating <span className="font-semibold">{businessName || 'client workspace'}</span></span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => setPickerOpen(true)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-1 font-medium transition-colors hover:bg-white/25 disabled:opacity-60">
            <ArrowLeftRight className="h-3.5 w-3.5" /> Switch Business
          </button>
          <button onClick={backToCompany} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-1 font-medium transition-colors hover:bg-white/25 disabled:opacity-60">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeft className="h-3.5 w-3.5" />} Back to Company
          </button>
        </div>
      </div>

      {pickerOpen && <SwitchPicker currentName={businessName} onClose={() => setPickerOpen(false)} />}
    </>
  )
}

// A searchable business picker that switches the active workspace IN PLACE — no round-trip through the
// company console. Server-side, POST switch re-verifies partner ownership before setting active_ws.
function SwitchPicker({ currentName, onClose }: { currentName: string | null; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Business[] | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (query: string) => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    const j = await fetch(`/api/partner/clients?${params}`).then((r) => r.json()).catch(() => null)
    setItems(j?.clients ? (j.clients as Business[]).filter((c) => c.tenant_id) : [])
  }, [])

  useEffect(() => { load('') }, [load])
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => load(q), 250)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [q, load])

  async function switchTo(tenantId: string | null) {
    if (!tenantId) return
    setSwitching(tenantId)
    const r = await fetch('/api/partner/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'switch', tenantId }) })
    if (!r.ok) { setSwitching(null); return }
    window.location.href = '/dashboard'
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <span className="font-semibold text-ink">Switch business</span>
          <button onClick={onClose} className="rounded-full bg-sunken p-1.5 text-subtle hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        <div className="border-b border-hairline p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search businesses…"
              className="h-10 w-full rounded-xl border border-hairline bg-canvas pl-9 pr-3 text-sm text-ink outline-none focus:border-accent/40" />
          </div>
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-2">
          {items === null ? (
            <div className="space-y-2 p-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-sunken" />)}</div>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">No businesses found.</p>
          ) : items.map((b) => {
            const isCurrent = b.business_name === currentName
            return (
              <button key={b.tenant_id} onClick={() => switchTo(b.tenant_id)} disabled={!!switching}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-sunken/70 disabled:opacity-60">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-sunken text-accent-strong"><Building2 className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{b.business_name}</span>
                  <span className="block text-xs capitalize text-muted">{b.status}</span>
                </span>
                {switching === b.tenant_id ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : isCurrent ? <Check className="h-4 w-4 text-accent-strong" /> : null}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

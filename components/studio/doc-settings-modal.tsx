'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

const input = 'h-11 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'

// One-time (editable) branding for every quote/invoice/production doc: logo, terms, validity.
export function DocSettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [logo, setLogo] = useState('')
  const [terms, setTerms] = useState('')
  const [days, setDays] = useState('30')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/studio/doc-settings').then((r) => r.json()).then((d) => {
      const s = d.settings || {}
      setLogo(s.logo_url || ''); setTerms(s.terms || ''); setDays(String(s.validity_days || 30))
    }).finally(() => setLoaded(true))
  }, [])

  async function save() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/studio/doc-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_url: logo, terms, validity_days: Number(days) || 30 }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      onSaved?.(); onClose()
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Document branding & terms</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-sunken"><X className="h-5 w-5" /></button>
        </div>
        {!loaded ? <p className="text-sm text-muted">Loading…</p> : (
          <div className="space-y-4">
            {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
            <div>
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Logo</span>
              <div className="flex items-center gap-3">
                {logo
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={logo} alt="" className="h-12 w-auto max-w-[120px] rounded border border-hairline object-contain" />
                  : <span className="flex h-12 w-20 items-center justify-center rounded border border-hairline bg-sunken text-xs text-muted">No logo</span>}
                <input className={input} value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="Paste a logo image URL" />
              </div>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Terms & conditions</span>
              <textarea className="w-full rounded-lg border border-hairline-strong p-3 text-sm outline-none focus:border-accent" rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. 50% deposit to confirm. Lead time 8–10 weeks. Prices valid for 30 days." />
            </label>
            <label className="block max-w-[200px]">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Quote valid for (days)</span>
              <input className={input} type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
            <div className="flex gap-2 pt-1">
              <button onClick={save} disabled={busy} className="h-11 rounded-lg bg-ink px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={onClose} className="h-11 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-ink">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

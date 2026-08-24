'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'

// Who is making this piece. Start typing and pick a factory already used before, or add a new one once.
//
// The whole point is that the address is chosen deliberately and then reused. Free-text retyping is what
// produced "Tatiana" / "Tatiana factory" / "t" / "prive" on one address, and a send with no recipient at
// all — so this component has no free-text fallback: a supplier is picked, or created and then picked.

export interface Supplier { id: string; name: string; contactName: string | null; email: string | null; phone: string | null }


export function SupplierPicker({ value, onChange, autoFocus }: {
  value: Supplier | null
  onChange: (s: Supplier | null) => void
  autoFocus?: boolean
}) {
  const [term, setTerm] = useState('')
  const [matches, setMatches] = useState<Supplier[]>([])
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', contactName: '', email: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Only the newest response may paint the list — a slow early request must not overwrite a later one.
  const seq = useRef(0)

  useEffect(() => {
    if (value || creating) return
    const mine = ++seq.current
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/suppliers?q=${encodeURIComponent(term.trim())}`)
        const j = await r.json()
        if (seq.current === mine) setMatches((j.suppliers ?? []) as Supplier[])
      } catch { /* a failed lookup just means no suggestions; Add a new supplier still works */ }
    }, 200)
    return () => clearTimeout(t)
  }, [term, value, creating])

  const create = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not save this supplier.')
      // Saving an address that already exists returns the existing record rather than a second one.
      onChange(j.supplier as Supplier)
      setCreating(false)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (value) {
    return (
      <div className="v2-card" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
        <div className="min-w-0" style={{ flex: 1 }}>
          <p className="truncate" style={{ fontSize: 14, fontWeight: 500, color: 'var(--v2-ink)' }}>{value.name}</p>
          <span className="truncate">{[value.contactName, value.email].filter(Boolean).join(' · ') || 'No email on file'}</span>
        </div>
        <button type="button" onClick={() => { onChange(null); setTerm('') }} className="v2-nx"
                style={{ alignSelf: 'auto', height: 30 }} aria-label="Choose a different supplier"><X /></button>
      </div>
    )
  }

  if (creating) {
    return (
      <div className="v2-card">
        <div className="v2-form">
          <div className="v2-fld"><label htmlFor="sp-name">Factory / workshop name</label>
            <input id="sp-name" autoFocus value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} placeholder="Gio Creations" /></div>
          <div className="v2-fld"><label htmlFor="sp-contact">Contact person</label>
            <input id="sp-contact" value={draft.contactName} onChange={(e) => setDraft((p) => ({ ...p, contactName: e.target.value }))} placeholder="Nancy" /></div>
          <div className="v2-fld"><label htmlFor="sp-email">Email</label>
            <input id="sp-email" type="email" value={draft.email} onChange={(e) => setDraft((p) => ({ ...p, email: e.target.value }))} placeholder="name@workshop.com" /></div>
          <div className="v2-fld"><label htmlFor="sp-phone">Phone</label>
            <input id="sp-phone" value={draft.phone} onChange={(e) => setDraft((p) => ({ ...p, phone: e.target.value }))} /></div>
        </div>
        {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><p>{err}</p></div>}
        <div className="v2-bar">
          <button type="button" onClick={create} disabled={busy || !draft.name.trim()} className="v2-act" data-solid>{busy ? 'Saving…' : 'Save supplier'}</button>
          <button type="button" onClick={() => { setCreating(false); setErr(null) }} className="v2-act">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="v2-fld">
        <label htmlFor="sp-search">Search factories</label>
        <input id="sp-search" autoFocus={autoFocus} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Start typing a name…" />
      </div>
      {/* The same list surface the customer typeahead uses — paper and one hairline, in flow here
          rather than floating, because this one is always open. */}
      <div style={{ marginTop: 8, border: '1px solid var(--v2-line)', borderRadius: 12, overflow: 'hidden' }}>
        {matches.map((s) => (
          <button key={s.id} type="button" onClick={() => onChange(s)} className="v2-popr">
            <span className="v2-popn truncate">{s.name}</span>
            <span className="v2-kick">{[s.contactName, s.email].filter(Boolean).join(' · ') || 'No email on file'}</span>
          </button>
        ))}
        {/* The empty state is the normal one on the first send — the table starts empty on purpose. */}
        {matches.length === 0 && (
          <p className="v2-kick" style={{ padding: '11px 13px' }}>{term.trim() ? 'No factory matches that.' : 'No factories saved yet.'}</p>
        )}
        <button
          type="button"
          onClick={() => { setDraft({ name: term.trim(), contactName: '', email: '', phone: '' }); setCreating(true) }}
          className="v2-popr"
          style={{ borderTop: '1px solid var(--v2-line)', borderBottom: 0, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--v2-t1)' }}
        >
          <Plus className="h-3.5 w-3.5" /> Add {term.trim() ? `"${term.trim()}"` : 'a new factory'}
        </button>
      </div>
    </div>
  )
}

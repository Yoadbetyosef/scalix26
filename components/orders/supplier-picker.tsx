'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'

// Who is making this piece. Start typing and pick a factory already used before, or add a new one once.
//
// The whole point is that the address is chosen deliberately and then reused. Free-text retyping is what
// produced "Tatiana" / "Tatiana factory" / "t" / "prive" on one address, and a send with no recipient at
// all — so this component has no free-text fallback: a supplier is picked, or created and then picked.

export interface Supplier { id: string; name: string; contactName: string | null; email: string | null; phone: string | null }

const inp = 'mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'

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
      <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-300 px-2.5 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">{value.name}</p>
          <p className="truncate text-xs text-gray-500">{[value.contactName, value.email].filter(Boolean).join(' · ') || 'No email on file'}</p>
        </div>
        <button type="button" onClick={() => { onChange(null); setTerm('') }} className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100" aria-label="Choose a different supplier"><X className="h-4 w-4" /></button>
      </div>
    )
  }

  if (creating) {
    return (
      <div className="rounded-lg border border-gray-300 p-2.5">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs text-gray-500">Factory / workshop name<input autoFocus value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} className={inp} placeholder="Gio Creations" /></label>
          <label className="block text-xs text-gray-500">Contact person<input value={draft.contactName} onChange={(e) => setDraft((p) => ({ ...p, contactName: e.target.value }))} className={inp} placeholder="Nancy" /></label>
          <label className="block text-xs text-gray-500">Email<input type="email" value={draft.email} onChange={(e) => setDraft((p) => ({ ...p, email: e.target.value }))} className={inp} placeholder="name@workshop.com" /></label>
          <label className="block text-xs text-gray-500">Phone<input value={draft.phone} onChange={(e) => setDraft((p) => ({ ...p, phone: e.target.value }))} className={inp} /></label>
        </div>
        {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={create} disabled={busy || !draft.name.trim()} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save supplier'}</button>
          <button type="button" onClick={() => { setCreating(false); setErr(null) }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <input
        autoFocus={autoFocus}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        className={inp}
        placeholder="Search factories…"
      />
      <div className="mt-1 overflow-hidden rounded-lg border border-gray-200">
        {matches.map((s) => (
          <button
            key={s.id} type="button" onClick={() => onChange(s)}
            className="flex w-full items-center gap-2 border-b border-gray-100 px-2.5 py-2 text-left last:border-b-0 hover:bg-gray-50"
          >
            <Check className="h-3.5 w-3.5 shrink-0 text-gray-300" />
            <span className="min-w-0">
              <span className="block truncate text-sm text-gray-900">{s.name}</span>
              <span className="block truncate text-xs text-gray-500">{[s.contactName, s.email].filter(Boolean).join(' · ') || 'No email on file'}</span>
            </span>
          </button>
        ))}
        {/* The empty state is the normal one on the first send — the table starts empty on purpose. */}
        {matches.length === 0 && (
          <p className="px-2.5 py-2 text-xs text-gray-400">{term.trim() ? 'No factory matches that.' : 'No factories saved yet.'}</p>
        )}
        <button
          type="button"
          onClick={() => { setDraft({ name: term.trim(), contactName: '', email: '', phone: '' }); setCreating(true) }}
          className="flex w-full items-center gap-1.5 border-t border-gray-100 px-2.5 py-2 text-left text-sm font-medium text-blue-600 hover:bg-blue-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add {term.trim() ? `"${term.trim()}"` : 'a new factory'}
        </button>
      </div>
    </div>
  )
}

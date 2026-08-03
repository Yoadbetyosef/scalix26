'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Search, X } from 'lucide-react'

// Customer field on an order: start typing a name and pick someone already in the address book. Choosing
// them fills email, phone, address and currency from the saved record and links the order to that contact,
// so the same customer is never re-keyed (and never duplicated) order after order.
//
// Typing a name that matches nobody is still valid — it's simply a walk-in whose details are typed once.

export interface PickedContact {
  id: string | null; name: string; email: string; phone: string; address: string; currency: string
}
interface Match { id: string; name: string | null; email: string | null; phone: string | null; address: string | null; currency: string | null }

const inp = 'mt-0.5 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm'

export function ContactPicker({ value, onChange }: { value: PickedContact; onChange: (v: PickedContact) => void }) {
  const [matches, setMatches] = useState<Match[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  // Only the latest response may update the list — a slow early request must not overwrite a newer one.
  const seq = useRef(0)

  // Debounced search while typing an unlinked name. Every setState happens inside the timeout callback —
  // a linked contact or a too-short term simply skips the fetch, and `showList` below hides whatever
  // the previous term had matched.
  useEffect(() => {
    const term = value.name.trim()
    if (value.id || term.length < 2) return
    const mine = ++seq.current
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/contacts/search?q=${encodeURIComponent(term)}`)
        const j = await r.json()
        if (seq.current === mine) { setMatches(j.contacts ?? []); setActive(0) }
      } catch { /* a failed lookup just means no suggestions — typing still works */ }
    }, 200)
    return () => clearTimeout(t)
  }, [value.name, value.id])

  // Close the suggestion list on an outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (m: Match) => {
    onChange({
      id: m.id, name: m.name ?? '', email: m.email ?? '', phone: m.phone ?? '',
      address: m.address ?? '', currency: m.currency ?? value.currency,
    })
    setOpen(false); setMatches([])
  }
  // Unlink but keep what's on screen, so details can be corrected for this one order.
  const unlink = () => onChange({ ...value, id: null })

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || !matches.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % matches.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  const showList = open && !value.id && value.name.trim().length >= 2 && matches.length > 0

  return (
    <div className="space-y-3">
      <div ref={box} className="relative">
        <label className="block text-xs text-gray-500">
          Customer
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              value={value.name}
              onChange={(e) => { onChange({ ...value, id: null, name: e.target.value }); setOpen(true) }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder="Start typing a name…"
              autoComplete="off"
              className={`${inp} pl-8 ${value.id ? 'border-emerald-300 bg-emerald-50/40' : ''}`}
            />
            {value.id && (
              <button type="button" onClick={unlink} title="Unlink this contact" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </label>

        {value.id && (
          <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700">
            <Check className="h-3 w-3" /> Linked to a saved contact — their details filled in below.
          </p>
        )}

        {showList && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            {matches.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(m)}
                  className={`block w-full px-3 py-2 text-left text-sm ${i === active ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                >
                  <span className="font-medium text-gray-900">{m.name || m.email || m.phone || 'Unnamed contact'}</span>
                  {(m.email || m.phone) && (
                    <span className="ml-2 text-xs text-gray-500">{[m.email, m.phone].filter(Boolean).join(' · ')}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block text-xs text-gray-500">Email<input value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} className={inp} /></label>
        <label className="block text-xs text-gray-500">Phone<input value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} className={inp} /></label>
        <label className="block text-xs text-gray-500">Address<input value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} className={inp} /></label>
        <label className="block text-xs text-gray-500">
          Currency
          <select value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value })} className={inp}>
            {['usd', 'cad', 'gbp', 'eur', 'ils'].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}

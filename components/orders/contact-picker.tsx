'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

// Customer field on an order: start typing a name and pick someone already in the address book. Choosing
// them fills email, phone, address and currency from the saved record and links the order to that contact,
// so the same customer is never re-keyed (and never duplicated) order after order.
//
// Typing a name that matches nobody is still valid — it's simply a walk-in whose details are typed once.

export interface PickedContact {
  id: string | null; name: string; email: string; phone: string; address: string; currency: string
}
interface Match { id: string; name: string | null; email: string | null; phone: string | null; address: string | null; currency: string | null }


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
    <div className="space-y-4">
      <div ref={box} className="relative">
        {/* Rule, not box — and the search icon sits on the baseline rather than inside a field,
            because there is no field to sit inside any more. Same treatment /inbox's search got. */}
        <div className="v2-fld" style={{ position: 'relative' }}>
          <label htmlFor="cp-name">Customer</label>
          <input
            id="cp-name"
            value={value.name}
            onChange={(e) => { onChange({ ...value, id: null, name: e.target.value }); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Start typing a name…"
            autoComplete="off"
            role="combobox"
            aria-expanded={showList}
            aria-controls="cp-list"
            style={{ paddingRight: 26, paddingLeft: 22 }}
          />
          <Search className="w-3.5 h-3.5" style={{ position: 'absolute', left: 2, bottom: 11, color: 'var(--v2-ink-45)', pointerEvents: 'none' }} />
          {value.id && (
            <button type="button" onClick={unlink} title="Unlink this contact" aria-label="Unlink this contact"
                    className="v2-nx" style={{ position: 'absolute', right: -6, bottom: 0, width: 28, alignSelf: 'auto', height: 30 }}>
              <X />
            </button>
          )}
        </div>

        {/* Linked reads as a state, so it is a chip in the settled hue rather than emerald text
            under an emerald-tinted input. The input itself does not change colour: a field that
            turns green is a field that has to be explained. */}
        {value.id && (
          <p style={{ marginTop: 6 }}>
            <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t2)' }}>Linked to a saved contact</span>
          </p>
        )}

        {showList && (
          /* The suggestion list. Paper, one hairline, the row's own hover — the same surface as
             every other list in the app rather than a shadowed popover. */
          <ul id="cp-list" role="listbox" className="v2-pop">
            {matches.map((m, i) => (
              <li key={m.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(m)}
                  className="v2-popr"
                  data-on={i === active || undefined}
                >
                  <span className="v2-popn">{m.name || m.email || m.phone || 'Unnamed contact'}</span>
                  {(m.email || m.phone) && <span className="v2-kick">{[m.email, m.phone].filter(Boolean).join(' · ')}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="v2-fld"><label htmlFor="cp-email">Email</label>
          <input id="cp-email" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} /></div>
        <div className="v2-fld"><label htmlFor="cp-phone">Phone</label>
          <input id="cp-phone" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} /></div>
        <div className="v2-fld"><label htmlFor="cp-addr">Address</label>
          <input id="cp-addr" value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} /></div>
        <div className="v2-fld"><label htmlFor="cp-cur">Currency</label>
          <span className="v2-sel">
            <select id="cp-cur" value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value })}>
              {['usd', 'cad', 'gbp', 'eur', 'ils'].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </span>
        </div>
      </div>
    </div>
  )
}

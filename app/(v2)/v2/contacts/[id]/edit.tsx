'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// EDITING A CONTACT — a sheet over the record, not a screen away from it.
//
// A form in place would turn DetailPage into a stateful component, and DetailPage is shared by
// contacts, agents and orders: every consumer would pay for one screen's needs. A route would be a
// full navigation and a back button for six fields, and it takes the record you are editing off the
// screen — which is exactly what you want to see while you change it. So: a sheet, with the facts
// still behind it.
//
// ── ABSENT IS NOT EMPTY ─────────────────────────────────────────────────────────────────────────
//
// Only fields the owner actually touched are sent. A blank left blank is not in the request and is
// untouched; a value DELETED is sent as '' and clears the column — and the route records that as a
// decision, so the AI never refills it. Sending all six every time would mark every field as decided
// the first time somebody fixed a typo, which is the whole-row freeze the column exists to avoid.

const FIELDS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'address', label: 'Address', type: 'text' },
  { key: 'currency', label: 'Currency', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
] as const

type Key = (typeof FIELDS)[number]['key']
export type ContactValues = Record<Key, string>

export function EditContact({ id, initial }: { id: string; initial: ContactValues }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [v, setV] = useState<ContactValues>(initial)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null)
  const first = useRef<HTMLInputElement>(null)

  // The field does not exist until the sheet has rendered.
  useEffect(() => { if (open) requestAnimationFrame(() => first.current?.focus()) }, [open])

  // Escape closes it, which is the one keyboard convention a sheet must not omit.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy])

  function close() {
    setOpen(false)
    setV(initial)
    setOutcome(null)
  }

  async function save() {
    if (busy) return
    // ONLY WHAT CHANGED. Everything else stays absent from the request and untouched by the route.
    const patch: Record<string, string> = {}
    for (const f of FIELDS) if (v[f.key].trim() !== initial[f.key].trim()) patch[f.key] = v[f.key].trim()
    if (!Object.keys(patch).length) { close(); return }

    setBusy(true)
    setOutcome(null)
    try {
      const res = await fetch(`/api/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        // A 409 carries the record it clashed with, so the message can name them rather than saying
        // "duplicate" and leaving the owner to guess who.
        const who = j.duplicateOf ? (j.duplicateOf.name || j.duplicateOf.phone || j.duplicateOf.email) : null
        setOutcome({ ok: false, message: who ? `That already belongs to ${who}.` : (j.error || 'That did not save.') })
        return
      }
      setOpen(false)
      setOutcome(null)
      router.refresh()
    } catch {
      setOutcome({ ok: false, message: 'That did not save — check your connection.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="v2-ract" data-tone="quiet" data-touch onClick={() => setOpen(true)}>Edit</button>

      {open && (
        <div className="v2-esheet" role="dialog" aria-modal="true" aria-label="Edit contact">
          {/* The veil is the close affordance as much as the button is. */}
          <button type="button" className="v2-eveil" aria-label="Cancel" onClick={close} disabled={busy} />
          <div className="v2-epanel">
            <p className="v2-etitle">Edit contact</p>

            {FIELDS.map((f, i) => (
              <label key={f.key} className="v2-efield">
                <span>{f.label}</span>
                {f.type === 'textarea' ? (
                  <textarea
                    value={v[f.key]}
                    onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                    rows={3}
                    disabled={busy}
                  />
                ) : (
                  <input
                    ref={i === 0 ? first : undefined}
                    type={f.type}
                    value={v[f.key]}
                    onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                    disabled={busy}
                  />
                )}
              </label>
            ))}

            {/* Said once, plainly, and left there until the next attempt. */}
            {outcome && <p className="v2-emsg" data-bad={!outcome.ok || undefined}>{outcome.message}</p>}

            {/* Clearing a field is a real thing to do here, and it is worth saying so: the AI will
                not fill it back in afterwards. Nothing else in the product explains that. */}
            <p className="v2-ehint">Anything you change here stays as you set it — including a field you empty.</p>

            <div className="v2-eacts">
              <button type="button" className="v2-esec" onClick={close} disabled={busy}>Cancel</button>
              <button type="button" className="v2-epri" onClick={() => void save()} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

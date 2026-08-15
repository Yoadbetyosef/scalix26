'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sheet, ContactFields, CONTACT_FORM_FIELDS, duplicateMessage,
  type ContactValues,
} from '../sheet'

// EDITING A CONTACT — a sheet over the record, not a screen away from it.
//
// A form in place would turn DetailPage into a stateful component, and DetailPage is shared by
// contacts, agents and orders: every consumer would pay for one screen's needs. A route would be a
// full navigation and a back button for six fields, and it takes the record you are editing off the
// screen — which is exactly what you want to see while you change it.
//
// The sheet shell, the field list and the duplicate sentence all live in ../sheet.tsx now, shared
// with New contact and Import file. Three copies of Escape handling is how one of them loses it.
//
// ── ABSENT IS NOT EMPTY ─────────────────────────────────────────────────────────────────────────
//
// Only fields the owner actually touched are sent. A blank left blank is not in the request and is
// untouched; a value DELETED is sent as '' and clears the column — and the route records that as a
// decision, so the AI never refills it. Sending all six every time would mark every field as decided
// the first time somebody fixed a typo, which is the whole-row freeze the column exists to avoid.

export function EditContact({ id, initial }: { id: string; initial: ContactValues }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [v, setV] = useState<ContactValues>(initial)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)

  function close() {
    setOpen(false)
    setV(initial)
    setOutcome(null)
  }

  async function save() {
    if (busy) return
    // ONLY WHAT CHANGED. Everything else stays absent from the request and untouched by the route.
    const patch: Record<string, string> = {}
    for (const f of CONTACT_FORM_FIELDS) if (v[f.key].trim() !== initial[f.key].trim()) patch[f.key] = v[f.key].trim()
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
        setOutcome(duplicateMessage(j, 'That did not save.'))
        return
      }
      setOpen(false)
      setOutcome(null)
      router.refresh()
    } catch {
      setOutcome('That did not save — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="v2-ract" data-tone="quiet" data-touch onClick={() => setOpen(true)}>Edit</button>

      {open && (
        <Sheet title="Edit contact" busy={busy} onClose={close}>
          <ContactFields values={v} onChange={setV} disabled={busy} />

          {/* Said once, plainly, and left there until the next attempt. */}
          {outcome && <p className="v2-emsg" data-bad>{outcome}</p>}

          {/* Clearing a field is a real thing to do here, and it is worth saying so: the AI will not
              fill it back in afterwards. Nothing else in the product explains that. */}
          <p className="v2-ehint">Anything you change here stays as you set it — including a field you empty.</p>

          <div className="v2-eacts">
            <button type="button" className="v2-esec" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="v2-epri" onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}

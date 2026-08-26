'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'

// EDITING A CONTACT IN v1.
//
// v1 had no contact edit at all — no form, no button, no PATCH call. Worse for the complaint that
// prompted this: the detail screen renders every field conditionally, so a missing one renders
// NOTHING. There was no empty box to click, and no way to learn that the field existed.
//
// So this form shows EVERY FIELD, always, whether or not it holds anything. An empty row you can
// click is what tells someone the field is there.
//
// ── IT IS THE SAME ROUTE THE v2 SHEET USES ──────────────────────────────────────────────────────
//
// PATCH /api/contacts/[id], the same six fields from contactFieldsSchema, the same manual_fields
// protection, the same 409-with-duplicateOf. v1 needed a SURFACE, not a route — the route's own
// comment said so and said to delete its rollout gate when this arrived.
//
// ── ONLY WHAT CHANGED IS SENT ───────────────────────────────────────────────────────────────────
//
// updateContact treats an absent key as untouched and a present blank one as CLEARED, and records
// both in manual_fields. That is the whole point of the column: `.is('name', null)` cannot tell a
// deliberate blank from a gap, so clearing a wrong name used to hand it straight back to the AI on
// the next call.
//
// Which is exactly why the patch carries CHANGES ONLY. Sending all six would mark every field
// decided the first time somebody fixed a typo — a whole-row freeze, from the column built to avoid
// one. The v2 sheet already worked this way; this form matching it is not a coincidence, it is the
// same rule reached twice.
//
// A blank that CHANGED is still sent, as null. That is the owner saying "we do not have this", which
// is a decision and must be recorded as one.

export interface ContactEditValues {
  company_name: string | null
  first_name: string | null
  last_name: string | null
  name: string | null
  email: string | null
  phone: string | null
  address: string | null
  currency: string | null
  notes: string | null
}

const FIELDS: Array<{ key: keyof ContactEditValues; label: string; type?: string; rows?: number; hint?: string }> = [
  // COMPANY FIRST, because for a B2B customer it is the name of the customer. The two parts of the
  // person's name follow it; `name` stays on the form as the single field every existing contact
  // already has, and is re-derived from the parts whenever either is edited (lib/contacts/store).
  { key: 'company_name', label: 'Company', hint: 'A business customer. Leave empty for a private one.' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'name', label: 'Full name', hint: 'Filled in from the two above when you use them.' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'address', label: 'Address' },
  { key: 'currency', label: 'Currency', hint: 'usd, cad — used on their documents' },
  { key: 'notes', label: 'Notes', rows: 4 },
]

export function ContactEdit({ contactId, initial }: { contactId: string; initial: ContactEditValues }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dupe, setDupe] = useState<{ id: string; name: string | null; email: string | null; phone: string | null } | null>(null)
  const [f, setF] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((x) => [x.key, initial[x.key] ?? ''])),
  )

  function close() {
    setOpen(false); setBusy(false); setErr(null); setDupe(null)
    setF(Object.fromEntries(FIELDS.map((x) => [x.key, initial[x.key] ?? ''])))
  }

  async function save() {
    if (busy) return
    setBusy(true); setErr(null); setDupe(null)
    try {
      // Changed fields only — see the note above the component.
      const patch: Record<string, string | null> = {}
      for (const x of FIELDS) {
        const now = f[x.key].trim()
        const was = (initial[x.key] ?? '').trim()
        if (now !== was) patch[x.key] = now || null
      }
      if (!Object.keys(patch).length) { setOpen(false); setBusy(false); return }

      const res = await fetch(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const j = await res.json().catch(() => ({}))
      // A 409 is not a failure to report and move on from: it means that number or address already
      // belongs to somebody, and the useful answer is WHO.
      if (res.status === 409 && j.duplicateOf) { setDupe(j.duplicateOf); return }
      if (!res.ok) { setErr(j.detail || j.error || 'That could not be saved.'); return }
      setOpen(false); setBusy(false)
      router.refresh()
    } catch {
      setErr('That could not be saved — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="v2-act">
        <Pencil className="h-3.5 w-3.5" /> Edit
      </button>
    )
  }

  return (
    <div className="v2-form mt-3" style={{ gridTemplateColumns: '1fr' }}>
      {/* EVERY FIELD, whether or not it has a value. The detail screen above renders them
          conditionally, which is correct for reading and is exactly why nothing looked editable.
          Rule, not box — the kit's form language, and the reason it suits this screen especially:
          the panel it sits in is already a stack of unboxed facts, so editing changes the ink and
          not the shape. */}
      {FIELDS.map((x) => (
        <div key={x.key} className="v2-fld">
          <label htmlFor={`ce-${x.key}`}>{x.label}</label>
          {x.rows ? (
            <textarea
              id={`ce-${x.key}`} value={f[x.key]} rows={x.rows} disabled={busy}
              onChange={(e) => setF((p) => ({ ...p, [x.key]: e.target.value }))}
            />
          ) : (
            <input
              id={`ce-${x.key}`} value={f[x.key]} type={x.type ?? 'text'} disabled={busy}
              onChange={(e) => setF((p) => ({ ...p, [x.key]: e.target.value }))}
            />
          )}
          {x.hint && <span className="v2-hint">{x.hint}</span>}
        </div>
      ))}

      <p className="v2-hint">
        Clearing a field is remembered as a decision — the AI will not fill it back in from a call.
      </p>

      {/* Both of these were red text. They are the kit's alert row now — the same treatment the
          amber upgrade panel got: the badge carries the urgency, the sentence carries the fact. */}
      {dupe && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
          <p>
            That number or address already belongs to{' '}
            <a href={`/contacts/${dupe.id}`} className="underline">{dupe.name || dupe.email || dupe.phone || 'another contact'}</a>.
          </p>
          <em>Duplicate</em>
        </div>
      )}
      {err && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
          <p>{err}</p>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={() => void save()} disabled={busy} className="v2-act" data-solid>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={close} disabled={busy} className="v2-act">Cancel</button>
      </div>
    </div>
  )
}

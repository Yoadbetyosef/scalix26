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
// So this form shows ALL SIX FIELDS, always, whether or not they hold anything. An empty row you can
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
  name: string | null
  email: string | null
  phone: string | null
  address: string | null
  currency: string | null
  notes: string | null
}

const FIELDS: Array<{ key: keyof ContactEditValues; label: string; type?: string; rows?: number; hint?: string }> = [
  { key: 'name', label: 'Name' },
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
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1.5 text-xs font-medium text-subtle hover:bg-sunken hover:text-ink"
      >
        <Pencil className="h-3.5 w-3.5" /> Edit
      </button>
    )
  }

  const input = 'mt-1 w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-hairline-strong'

  return (
    <div className="mt-3 space-y-3">
      {/* EVERY FIELD, whether or not it has a value. The detail screen above renders them
          conditionally, which is correct for reading and is exactly why nothing looked editable. */}
      {FIELDS.map((x) => (
        <label key={x.key} className="block text-xs text-subtle">
          {x.label}
          {x.rows ? (
            <textarea
              value={f[x.key]} rows={x.rows} disabled={busy}
              onChange={(e) => setF((p) => ({ ...p, [x.key]: e.target.value }))}
              className={input}
            />
          ) : (
            <input
              value={f[x.key]} type={x.type ?? 'text'} disabled={busy}
              onChange={(e) => setF((p) => ({ ...p, [x.key]: e.target.value }))}
              className={input}
            />
          )}
          {x.hint && <span className="mt-1 block text-[11px] text-muted">{x.hint}</span>}
        </label>
      ))}

      <p className="text-[11px] text-muted">
        Clearing a field is remembered as a decision — the AI will not fill it back in from a call.
      </p>

      {dupe && (
        <p className="text-xs text-red-600">
          That number or address already belongs to{' '}
          <a href={`/contacts/${dupe.id}`} className="underline">{dupe.name || dupe.email || dupe.phone || 'another contact'}</a>.
        </p>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}

      <div className="flex gap-2">
        <button onClick={() => void save()} disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={close} disabled={busy} className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-subtle hover:bg-sunken">
          Cancel
        </button>
      </div>
    </div>
  )
}

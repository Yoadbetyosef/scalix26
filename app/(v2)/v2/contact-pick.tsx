'use client'

import { useEffect, useRef, useState } from 'react'

// PICK A CUSTOMER, OR TYPE A NEW ONE.
//
// Two forms need this now — a new appointment and a new invoice — so it lives once. The type-ahead
// goes through /api/contacts/search, which is searchContacts: tenant-scoped, archived and merged-away
// records excluded, so the picker can never offer a record that should not be reused.
//
// A NEW customer is created through POST /api/contacts, which matches on the last ten digits and
// answers 409 with the record it clashed with. That matters more here than anywhere: a person typing
// a number that already belongs to somebody must be shown that somebody, not told "duplicate" and
// left to guess. `createContactFor` below returns that record so the caller can offer it.

export interface PickedContact { id: string; name: string | null; phone: string | null; email: string | null }

export function ContactPick({
  picked, onPick, disabled, autoFocus,
}: {
  picked: PickedContact | null
  /** Null clears the choice; a contact sets it. Typing is reported through `onDraft`. */
  onPick: (c: PickedContact | null) => void
  disabled?: boolean
  autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PickedContact[]>([])
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => { if (autoFocus) requestAnimationFrame(() => field.current?.focus()) }, [autoFocus])

  useEffect(() => {
    if (picked || q.trim().length < 1) { setHits([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/contacts/search?q=${encodeURIComponent(q.trim())}`)
        const j = await r.json().catch(() => ({}))
        if (!cancelled) setHits((j.contacts ?? []).slice(0, 5))
      } catch { /* a failed lookup must never block typing a new customer */ }
    }, 180)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, picked])

  if (picked) {
    return (
      <label className="v2-efield">
        <span>Customer</span>
        <button type="button" className="v2-ap-picked" onClick={() => onPick(null)} disabled={disabled}>
          {picked.name || picked.phone || picked.email}<i>change</i>
        </button>
      </label>
    )
  }

  return (
    <>
      <label className="v2-efield">
        <span>Customer</span>
        <input
          ref={field}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search contacts, or type a name"
          disabled={disabled}
        />
      </label>
      {hits.length > 0 && (
        <div className="v2-ap-hits">
          {hits.map((c) => (
            <button key={c.id} type="button" onClick={() => { onPick(c); setQ(''); setHits([]) }}>
              <b>{c.name || 'No name'}</b><span>{c.phone || c.email}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

/** The typed name, for a caller that needs to create the contact rather than pick one. */
export function useTypedName(): [string, (v: string) => void] {
  const [v, set] = useState('')
  return [v, set]
}

export interface CreateContactResult {
  ok: boolean
  contact?: PickedContact
  /** Set when the number or address already belongs to somebody. The caller offers THEM. */
  duplicateOf?: PickedContact
  error?: string
}

/**
 * Create a customer for a form that needs one.
 *
 * A 409 is not a failure to report and move on from — it means the person is already in the book, and
 * the right answer is to use that record. The caller decides, because "use them instead" reads
 * differently on an appointment than on an invoice.
 */
export async function createContactFor(input: { name?: string; phone?: string; email?: string }): Promise<CreateContactResult> {
  try {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: (input.name ?? '').trim() || null,
        phone: (input.phone ?? '').trim() || null,
        email: (input.email ?? '').trim() || null,
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.status === 409 && j.duplicateOf) return { ok: false, duplicateOf: j.duplicateOf }
    if (!res.ok) return { ok: false, error: j.detail || j.error || 'That customer could not be saved.' }
    return { ok: true, contact: j.contact }
  } catch {
    return { ok: false, error: 'That customer could not be saved — check your connection.' }
  }
}

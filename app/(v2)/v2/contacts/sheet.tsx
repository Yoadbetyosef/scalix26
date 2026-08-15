'use client'

import { useEffect, useRef } from 'react'

// The shell moved to ../form-sheet.tsx when the agenda started opening it too — four surfaces, one
// sheet. Re-exported so every existing import is unchanged.
export { Sheet } from '../form-sheet'

// ── The six fields a person may set ─────────────────────────────────────────────────────────────
//
// The same six create and edit both write, from lib/contacts/schema.ts. Not channel (set once by
// whichever door they came in through), not language (nothing writes it), not the derived counters.

export const CONTACT_FORM_FIELDS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'address', label: 'Address', type: 'text' },
  { key: 'currency', label: 'Currency', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
] as const

export type ContactKey = (typeof CONTACT_FORM_FIELDS)[number]['key']
export type ContactValues = Record<ContactKey, string>

export const emptyContact = (): ContactValues => ({
  name: '', phone: '', email: '', address: '', currency: '', notes: '',
})

export function ContactFields({
  values, onChange, disabled,
}: { values: ContactValues; onChange: (v: ContactValues) => void; disabled?: boolean }) {
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { requestAnimationFrame(() => first.current?.focus()) }, [])

  return (
    <>
      {CONTACT_FORM_FIELDS.map((f, i) => (
        <label key={f.key} className="v2-efield">
          <span>{f.label}</span>
          {f.type === 'textarea' ? (
            <textarea value={values[f.key]} onChange={(e) => onChange({ ...values, [f.key]: e.target.value })} rows={3} disabled={disabled} />
          ) : (
            <input
              ref={i === 0 ? first : undefined}
              type={f.type}
              value={values[f.key]}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
              disabled={disabled}
            />
          )}
        </label>
      ))}
    </>
  )
}

/**
 * The message for a 409, naming who the record clashed with rather than saying "duplicate".
 *
 * Shared because create and edit answer with the SAME contract — `duplicateOf` attached — and the
 * sentence a person reads should not depend on which of the two they happened to be using.
 */
export function duplicateMessage(j: { error?: string; duplicateOf?: { id?: string; name?: string | null; phone?: string | null; email?: string | null } }, fallback: string) {
  const d = j.duplicateOf
  if (!d) return j.error || fallback
  const who = d.name || d.phone || d.email || 'someone already in your contacts'
  return `That number or address belongs to ${who}.`
}

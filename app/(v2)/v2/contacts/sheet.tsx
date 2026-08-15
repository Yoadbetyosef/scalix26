'use client'

import { useEffect, useRef, type ReactNode } from 'react'

// THE SHEET, ONCE.
//
// Three surfaces need it now — edit a contact, add one, import a file — and the pattern was written
// for the first of them. A second copy would drift on the parts nobody thinks about until they are
// missing: Escape, the veil being a real button, the focus landing somewhere, reduced motion.
//
// Extracted from contacts/[id]/edit.tsx unchanged. Same markup, same classes, same behaviour.

export function Sheet({
  title, wide, busy, onClose, children,
}: {
  title: string
  /** The importer needs room for a column grid; the two forms do not. */
  wide?: boolean
  /** While true, the sheet refuses to close — a half-finished write is not a thing to dismiss. */
  busy?: boolean
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  return (
    <div className="v2-esheet" role="dialog" aria-modal="true" aria-label={title}>
      {/* A button, not a div: closing by clicking away is an action, and one a keyboard can reach. */}
      <button type="button" className="v2-eveil" aria-label="Cancel" onClick={onClose} disabled={busy} />
      <div className="v2-epanel" data-wide={wide || undefined}>
        <p className="v2-etitle">{title}</p>
        {children}
      </div>
    </div>
  )
}

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

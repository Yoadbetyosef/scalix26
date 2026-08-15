'use client'

import { useEffect, type ReactNode } from 'react'

// THE SHEET, ONCE — for every /v2 surface that asks a person for something.
//
// It was written for the contact edit, then New contact and Import file opened it, and now the
// agenda's New appointment does too. Four copies would drift on exactly the parts nobody thinks about
// until one is missing: Escape, the veil being a real button, focus landing somewhere, reduced motion.
//
// It lives at the /v2 root rather than under contacts/ because it is no longer a contacts thing.
// (Not `sheet.tsx` — that name is taken by the mobile home's pull-up, which is a different object
// with a drag gesture.)

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

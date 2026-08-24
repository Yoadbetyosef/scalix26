'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useSheetDrag } from '@/app/(v2)/v2/use-sheet-drag'

/**
 * THE PHONE'S NAVIGATION, AS /v2 DESIGNED IT.
 *
 * v1 had a five-slot tab bar pinned to the bottom — four routes and a "More" that opened a second,
 * differently-shaped drawer holding everything else. Two surfaces, two languages, and an arbitrary
 * line drawn at four: which four you got depended on which modules your business had enabled, so no
 * two tenants navigated the same way and nobody could learn where anything was.
 *
 * This is the interaction /v2 already had: a handle at the bottom edge, and one sheet that pulls up
 * over the page carrying the SAME three sections as the desktop rail, in the same order, with the
 * same gating. Nothing is promoted and nothing is hidden behind a second door.
 *
 * ── WHY THE SHELL IS A FIXED HOST AROUND AN ABSOLUTE SHEET ──────────────────────────────────────
 *
 * .v2-sheet is position:absolute, because on /v2 it lives inside .v2-root, which owns the viewport.
 * A navigation sheet has no such parent — it has to be fixed. Rather than write a second sheet that
 * would then have to be kept in step with the first, the host is fixed and inset-0, so the sheet's
 * `absolute` resolves against it and every other rule it already has — the 88dvh, the radius, the
 * translateY(100%) at rest, the 0.42s settle, the [data-open] — applies unchanged. One sheet.
 *
 * The drag hook is /v2's too, including its one real rule: when the sheet is open and its list is
 * scrolled down, a downward drag scrolls rather than closing.
 */
export function MobileSheet({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const sheetEl = useRef<HTMLDivElement>(null)
  const scrollEl = useRef<HTMLDivElement>(null)
  const handleEl = useRef<HTMLButtonElement>(null)
  useSheetDrag({ open, setOpen, sheet: sheetEl, scroller: scrollEl, handle: handleEl })

  // Navigating closes it. Without this the sheet stays up over the page it just sent you to.
  useEffect(() => { setOpen(false) }, [pathname])

  // Escape closes it, and the page behind holds still while it is up — the same two courtesies the
  // modal owes, for the same reason: this covers 88% of the screen.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const b = document.body, prev = b.style.overflow
    b.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); b.style.overflow = prev }
  }, [open])

  return (
    <div className="v2 v2-navhost md:hidden" data-open={open || undefined}>
      {/* The veil only exists while it is up, so a tap outside closes it the way every other sheet
          in the app behaves. Below the sheet, above the page. */}
      {open && <div className="v2-navveil" onClick={() => setOpen(false)} aria-hidden />}

      {!open && (
        <button
          type="button"
          className="v2-grab"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={false}
        >
          <s />
          <span>{label}</span>
        </button>
      )}

      <div className="v2-sheet" ref={sheetEl} data-open={open || undefined}
           role="navigation" aria-label="Main" aria-hidden={!open || undefined}>
        <button ref={handleEl} type="button" className="v2-sh" onClick={() => setOpen((v) => !v)}
                aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open}>
          <s />
        </button>
        <div className="v2-sin" ref={scrollEl} data-scroll>
          {children(() => setOpen(false))}
        </div>
      </div>
    </div>
  )
}

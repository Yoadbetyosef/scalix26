'use client'

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * THE MODAL THE KIT DID NOT HAVE.
 *
 * /contacts opens two — New contact and the three-step Import wizard — and both were built inline
 * from the card's edge language because there was nothing to reach for. OUTSTANDING §29 recorded
 * that as a hold rather than a gap to paper over: a modal is not a rounded box on a dim background,
 * it is a box that takes the keyboard and gives it back, and inventing one per page is how a second
 * language starts.
 *
 * So this is the box AND the four behaviours a dialog owes you:
 *
 *   FOCUS GOES IN.        On open, to the first focusable thing inside, or to the panel itself if
 *                         there is nothing — never left on the button behind the veil, where the
 *                         next Tab walks the page underneath.
 *   FOCUS STAYS IN.       Tab and Shift+Tab wrap at the ends. Recomputed on every keypress rather
 *                         than cached on open, because these dialogs change what they contain: the
 *                         import wizard swaps its whole body at each step.
 *   FOCUS COMES BACK.     On close, to whatever had it before. Restored in a cleanup, so it happens
 *                         on unmount too and not only on a well-behaved close.
 *   THE PAGE HOLDS STILL. Scroll locked on <body>, with the scrollbar's width replaced as padding —
 *                         locking without that reflows the entire page sideways the moment the
 *                         dialog opens, which reads as the layout flinching.
 *
 * Escape closes, and the veil closes on click. Neither is a substitute for a Cancel button; both are
 * what people try first.
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface ModalProps {
  open: boolean
  onClose: () => void
  /** The mono micro-label at the top. A dialog says what it is in the rail's own voice. */
  title: string
  /** Optional second clause on the title line — the import wizard uses it for the step. */
  step?: string
  children: ReactNode
  /** The buttons. Kept out of `children` so every dialog puts them in the same place. */
  actions?: ReactNode
  /** Wider, for a dialog whose body is a table rather than a form. */
  wide?: boolean
  /** Set false while a request is in flight, so a stray Escape cannot abandon a half-done save. */
  dismissable?: boolean
}

export function Modal({ open, onClose, title, step, children, actions, wide, dismissable = true }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const titleId = useId()

  const close = useCallback(() => { if (dismissable) onClose() }, [dismissable, onClose])

  // ── focus in, and back out again ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    returnTo.current = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel.current)?.focus()
    return () => { returnTo.current?.focus?.() }
  }, [open])

  // ── the page holds still ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const b = document.body
    const prevOverflow = b.style.overflow, prevPad = b.style.paddingRight
    const gap = window.innerWidth - document.documentElement.clientWidth
    b.style.overflow = 'hidden'
    if (gap > 0) b.style.paddingRight = `${gap}px`
    return () => { b.style.overflow = prevOverflow; b.style.paddingRight = prevPad }
  }, [open])

  // ── escape, and the tab trap ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return }
      if (e.key !== 'Tab' || !panel.current) return
      // Read the focusables NOW: the wizard replaces its body between steps.
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter(el => el.offsetParent !== null || el === document.activeElement)
      if (!items.length) { e.preventDefault(); panel.current.focus(); return }
      const firstEl = items[0], lastEl = items[items.length - 1]
      if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus() }
      else if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus() }
      else if (!panel.current.contains(document.activeElement)) { e.preventDefault(); firstEl.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, close])

  if (!open) return null

  return (
    <div className="v2 v2-modal-wrap" role="presentation">
      <div className="v2-veil" onClick={close} aria-hidden />
      <div
        ref={panel}
        className="v2-modal"
        data-wide={wide || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="v2-head" style={{ marginBottom: 16 }}>
          <p className="v2-kick" id={titleId} style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
            <i />{title}{step ? ` · ${step}` : ''}
          </p>
          <s />
        </div>
        <div className="v2-modal-body">{children}</div>
        {actions && <div className="v2-modal-acts">{actions}</div>}
      </div>
    </div>
  )
}

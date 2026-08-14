'use client'

import { useEffect, useRef, type RefObject } from 'react'

// THE SHEET RESPONDS TO THE GESTURE IT ADVERTISES.
//
// It said SWIPE UP and opened on tap. This adds the swipe — both directions — and changes nothing
// else: the tap still opens it, the same state flips, and the sheet still settles with the same CSS
// transition it always had. The drag only takes the transform over while a finger is down.
//
// Pointer events, not touch events, so a trackpad drag behaves the same as a thumb. No library: the
// whole gesture is a start point, a delta, and one decision on release.
//
// ── THE ONE RULE THAT MATTERS ───────────────────────────────────────────────────────────────────────
//
// When the sheet is open and its list is scrolled down, a downward drag must SCROLL, not close. Only
// a drag that begins at scrollTop 0 may close it — otherwise the sheet closes every time somebody
// scrolls back up through the threads, which is the single most common thing they will do in it.

/** Past this, a press is a drag rather than a tap. Below it, nothing is claimed and the tap survives. */
const SLOP = 8
/** A flick this fast commits regardless of how far it travelled. px per ms. */
const FLICK = 0.5
/** A slow drag commits past a third of the sheet's own height. */
const COMMIT = 1 / 3

interface Args {
  open: boolean
  setOpen: (v: boolean) => void
  sheet: RefObject<HTMLDivElement | null>
  /** The sheet's scroller. A close-drag may only begin when this is at the top. */
  scroller: RefObject<HTMLDivElement | null>
  /** The handle: a drag may always begin here, scrolled or not. */
  handle: RefObject<HTMLElement | null>
}

// ── TEMPORARY INSTRUMENTATION ───────────────────────────────────────────────────────────────────────
//
// Deliberately not gated on NODE_ENV: the device that cannot drag is a phone against a deployed
// build, and a log that only runs locally would answer nothing. REMOVE once the gesture is confirmed.
const D = (...a: unknown[]) => console.info('[sheet]', ...a)
const where = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  if (!el?.tagName) return '(none)'
  const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/).join('.')}` : ''
  return `${el.tagName.toLowerCase()}${cls}`.slice(0, 70)
}

export function useSheetDrag({ open, setOpen, sheet, scroller, handle }: Args) {
  // Everything the move handler needs, in refs: the listeners are attached once and must not be
  // re-subscribed mid-gesture by a re-render.
  const openRef = useRef(open)
  openRef.current = open

  const from = useRef<{ y: number; t: number } | null>(null)
  const dragging = useRef(false)
  const moved = useRef(false)

  useEffect(() => {
    const el = sheet.current
    if (!el) return

    const height = () => el.getBoundingClientRect().height || window.innerHeight * 0.88

    // What the browser has ALREADY decided about these elements, before a finger touches them. If
    // touch-action is anything but `none`, the browser owns a vertical drag and this hook will only
    // ever see pointerdown followed by pointercancel.
    D('bound', {
      sheet: !!el,
      sheetTouchAction: getComputedStyle(el).touchAction,
      handleTouchAction: handle.current ? getComputedStyle(handle.current).touchAction : '(no handle)',
      heroTouchAction: getComputedStyle(document.body).touchAction,
      pointerEventsSupported: typeof window.PointerEvent !== 'undefined',
    })

    /** While a finger is down the sheet follows it, so the transition must not fight the movement. */
    const follow = (dy: number) => {
      el.style.transition = 'none'
      el.style.transform = openRef.current
        ? `translateY(${Math.max(0, dy)}px)`
        : `translateY(calc(100% - ${Math.max(0, -dy)}px))`
    }

    /** Hand the transform back to CSS, which owns both resting positions. */
    const release = () => {
      el.style.transition = ''
      el.style.transform = ''
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const target = e.target as HTMLElement | null
      const insideSheet = !!target && el.contains(target)

      if (openRef.current) {
        // Closing. Only from the handle, or from anywhere in the sheet when its list is already at
        // the top — a drag that starts mid-scroll belongs to the list.
        if (!insideSheet) return
        const onHandle = !!handle.current && !!target && handle.current.contains(target)
        const atTop = (scroller.current?.scrollTop ?? 0) <= 0
        if (!onHandle && !atTop) return
      } else {
        // Opening. Anywhere on the hero — but never a press that began inside the sheet itself.
        if (insideSheet) return
      }

      from.current = { y: e.clientY, t: e.timeStamp }
      dragging.current = false
      moved.current = false
      D('down', {
        on: where(e.target), type: e.pointerType, y: Math.round(e.clientY),
        open: openRef.current, scrollTop: scroller.current?.scrollTop ?? null,
      })
    }

    const onMove = (e: PointerEvent) => {
      const start = from.current
      if (!start) return
      const dy = e.clientY - start.y
      // The direction that makes sense for the current state. The other way is not this gesture.
      const wanted = openRef.current ? dy : -dy
      if (!dragging.current) {
        if (wanted < SLOP) {
          // A press that wanders the wrong way, or barely at all, is somebody else's gesture — a tap,
          // or a scroll. Give it up rather than fight for it.
          if (Math.abs(dy) > SLOP) from.current = null
          return
        }
        dragging.current = true
      }
      moved.current = true
      // Non-passive, so this can stop the page rubber-banding under the drag.
      if (e.cancelable) e.preventDefault()
      D('move', { dy: Math.round(dy), wanted: Math.round(wanted), cancelable: e.cancelable })
      follow(dy)
    }

    const onUp = (e: PointerEvent) => {
      const start = from.current
      from.current = null
      if (!start || !dragging.current) {
        D('up (no drag)', { started: !!start, dragging: dragging.current })
        dragging.current = false
        return
      }
      dragging.current = false

      const dy = e.clientY - start.y
      const travelled = openRef.current ? dy : -dy
      const ms = Math.max(1, e.timeStamp - start.t)
      const velocity = travelled / ms

      D('up', {
        travelled: Math.round(travelled), velocity: Number(velocity.toFixed(3)),
        commit: velocity > FLICK || travelled > height() * COMMIT, third: Math.round(height() * COMMIT),
      })
      release()
      // Either is enough: a fast flick commits even if short, and a slow drag commits once it has
      // covered a third of the sheet. Anything else springs back to where it started, which is what
      // leaving the transform to CSS already does.
      if (velocity > FLICK || travelled > height() * COMMIT) setOpen(!openRef.current)
    }

    const onCancel = (e: PointerEvent) => {
      // THE ONE TO WATCH. A cancel arriving straight after a down means the browser took the gesture
      // for panning — which is what touch-action anything-but-none tells it to do.
      D('CANCEL — the browser took the gesture', { on: where(e.target), dragging: dragging.current })
      from.current = null
      dragging.current = false
      release()
    }

    // A drag that moved must not also register as a tap on whatever was under the finger.
    const onClick = (e: MouseEvent) => {
      if (!moved.current) return
      moved.current = false
      e.stopPropagation()
      e.preventDefault()
    }

    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('click', onClick, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('click', onClick, { capture: true })
    }
  }, [sheet, scroller, handle, setOpen])
}

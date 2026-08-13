'use client'

import { useEffect } from 'react'

// THE PRESS STATE'S TOUCH HALF, LIFTED OUT OF THE SHEET.
//
// It lived in sheet.tsx because that is where it was first needed. Desktop needs :active only, so
// copying it would have put two identical listeners in two files with nothing keeping them in step —
// the same shape as the two integration readers before they were merged. One hook, mounted once by
// the shell, and both surfaces read the attribute it sets.
//
// iOS Safari drops :active on a scrollable surface unless the document carries a touchstart listener.
// This mirrors the state onto [data-pressed]; every rule that styles a press reads BOTH, so a mouse
// gets :active and a finger gets the attribute.
//
// Presentation only: it sets and removes an attribute and does nothing else.
export function usePressState() {
  useEffect(() => {
    const mark = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-touch]') as HTMLElement | null
      if (el && !(el as HTMLButtonElement).disabled) el.setAttribute('data-pressed', '')
    }
    const clear = () => document.querySelectorAll('[data-pressed]').forEach((el) => el.removeAttribute('data-pressed'))
    document.addEventListener('touchstart', mark, { passive: true })
    document.addEventListener('touchend', clear, { passive: true })
    document.addEventListener('touchcancel', clear, { passive: true })
    return () => {
      document.removeEventListener('touchstart', mark)
      document.removeEventListener('touchend', clear)
      document.removeEventListener('touchcancel', clear)
    }
  }, [])
}

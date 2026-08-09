'use client'

import { useEffect, useState } from 'react'

// Which layout is live.
//
// ── WHY THIS EXISTS RATHER THAN A CSS MEDIA QUERY ───────────────────────────────────────────────────
//
// The first version rendered the hero in BOTH trees and let `display:none` hide one. That is fine for
// static markup and wrong the moment the hero owns imperative state: two <canvas> elements mounted,
// both calling useImperativeHandle on the same ref, so the last one to mount won the ref. On a desktop
// viewport that was the hidden mobile canvas — zero width, so fit() bailed and nothing ever drew, and
// every Rudi.listen() drove an element nobody could see.
//
// So the breakpoint has to be a value React knows about, not just something CSS acts on: exactly one
// tree renders, exactly one canvas exists, and the ref is unambiguous.
//
// 720px matches the CSS breakpoint in v2-tokens.css. If one moves, the other moves with it.

export const MOBILE_QUERY = '(max-width: 719.98px)'

export function useIsMobile(): boolean | null {
  // null until measured. The layout renders nothing rather than guessing and flashing the wrong tree
  // — a hero that appears at desktop size for one frame and then jumps is worse than one that arrives
  // a frame late.
  const [isMobile, setIsMobile] = useState<boolean | null>(null)

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const apply = () => setIsMobile(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  return isMobile
}

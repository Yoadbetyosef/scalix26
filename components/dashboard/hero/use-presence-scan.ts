'use client'

import { useEffect, useRef, type RefObject } from 'react'
import type { RudiHandle } from '@/app/(v2)/v2/rudi-canvas'
import { useRudiPresence } from './rudi-presence'

/**
 * The presence ripple, as his scan.
 *
 * RudiPresenceProvider holds one Supabase subscription on `leads` and bumps `eventKey` when
 * something lands. That used to expand a ring around a glass lens; it runs the canvas's own scan
 * now — same signal, same meaning, and the gesture already exists so nothing new is drawn for it.
 *
 * Shared because both surfaces want it and a second copy would drift: the orb in the identity slot
 * and the band at the top of the dashboard.
 *
 * Skipped on the first render. `eventKey` is seeded with whatever the context is already holding, so
 * scanning on mount would announce a new lead every time somebody opened the dashboard.
 */
export function usePresenceScan(handle: RefObject<RudiHandle | null>) {
  const { eventKey } = useRudiPresence()
  const seen = useRef(eventKey)

  useEffect(() => {
    if (eventKey === seen.current) return
    seen.current = eventKey
    handle.current?.scan()
  }, [eventKey, handle])
}

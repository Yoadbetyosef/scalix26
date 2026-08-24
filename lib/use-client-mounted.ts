'use client'

import { useSyncExternalStore } from 'react'

/**
 * True once we are on the client, false during server render — without a setState in an effect.
 *
 * `useState(false)` + `useEffect(() => setMounted(true))` is the usual spelling and this repo's lint
 * rejects it, correctly: it is a synchronous setState inside an effect, which schedules a second
 * render on every mount of every component that uses it. `useSyncExternalStore` answers the same
 * question in one pass — the server snapshot is false, the client snapshot is true, and the
 * subscribe function never fires because the answer cannot change.
 *
 * It exists for createPortal, which needs a real `document`.
 */
const noop = () => () => {}
export const useClientMounted = () => useSyncExternalStore(noop, () => true, () => false)

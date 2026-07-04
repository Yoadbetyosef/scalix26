'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AiOrb, type OrbState } from '@/components/brand/ai-orb'

// One shared "Rudi is alive" presence for the dashboard: a SINGLE Supabase Realtime
// subscription on `leads` (the same source the notification center uses) drives the orb's
// new-event ripple + haptics, and visibility drives the pause (W1/W5/W6). Both orb instances
// (mobile + desktop) consume this context so nothing subscribes twice.
//
// NOTE (W2/live-call): `orbState` stays 'idle' because the app does not yet emit an
// "active call" event to the client. When such a signal exists, set orbState='live' here and
// the orb + banner light up automatically (green accent, faster waveform).
interface RudiCtx { orbState: OrbState; eventKey: number; paused: boolean; pulse: number }
const Ctx = createContext<RudiCtx>({ orbState: 'idle', eventKey: 0, paused: false, pulse: 0 })
export const useRudiPresence = () => useContext(Ctx)

export function RudiPresenceProvider({ tenantId, children }: { tenantId?: string; children: React.ReactNode }) {
  const [eventKey, setEventKey] = useState(0)
  const [pulse, setPulse] = useState(0)
  const [paused, setPaused] = useState(false)
  const orbState: OrbState = 'idle'

  // W6 — pause all orb animation when the tab is hidden.
  useEffect(() => {
    const onVis = () => setPaused(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    setPaused(document.hidden)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // W1 new-event ripple + W5 haptics — from the real leads Realtime stream.
  useEffect(() => {
    if (!tenantId) return
    const supabase = createClient()
    const fire = (booked: boolean) => {
      setEventKey((k) => k + 1)
      setPulse((p) => p + 1)
      try { navigator.vibrate?.(booked ? [20, 40, 20] : 30) } catch { /* unsupported (iOS Safari) */ }
    }
    const ch = supabase
      .channel('rudi-presence')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads', filter: `tenant_id=eq.${tenantId}` }, () => fire(false))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads', filter: `tenant_id=eq.${tenantId}` }, (p) => {
        if ((p.new as { status?: string }).status === 'booked') fire(true)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [tenantId])

  return <Ctx.Provider value={{ orbState, eventKey, paused, pulse }}>{children}</Ctx.Provider>
}

/** The orb, wired to the shared presence (state + one-shot ripple + pause). */
export function LiveOrb() {
  const { orbState, eventKey, paused } = useRudiPresence()
  return <AiOrb state={orbState} eventKey={eventKey} paused={paused} />
}

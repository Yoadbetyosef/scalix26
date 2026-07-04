'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sparkles, Check } from 'lucide-react'
import { AiOrb, type OrbState } from '@/components/brand/ai-orb'

// One shared "Rudi is alive" presence for the dashboard: a SINGLE Supabase Realtime
// subscription on `leads` (the same source the notification center uses) drives the orb's
// new-event ripple, haptics, and the ambient glass toasts (B1/B7/W1/W5). Visibility drives the
// pause (W6/B10). Both orb instances (mobile + desktop) consume this context so nothing
// subscribes twice.
//
// NOTE (B8/B9 live-call): `orbState` stays 'idle' because the app does not yet emit an "active
// call" event to the client. When that signal exists, set orbState='live' here and the orb +
// live-call banner light up automatically (green accent, faster waveform).
export interface RudiEvent { key: number; type: 'new' | 'booked'; name: string }
interface RudiCtx { orbState: OrbState; eventKey: number; paused: boolean; pulse: number; lastEvent: RudiEvent | null }
const Ctx = createContext<RudiCtx>({ orbState: 'idle', eventKey: 0, paused: false, pulse: 0, lastEvent: null })
export const useRudiPresence = () => useContext(Ctx)

export function RudiPresenceProvider({ tenantId, children }: { tenantId?: string; children: React.ReactNode }) {
  const [eventKey, setEventKey] = useState(0)
  const [pulse, setPulse] = useState(0)
  const [paused, setPaused] = useState(false)
  const [lastEvent, setLastEvent] = useState<RudiEvent | null>(null)
  const orbState: OrbState = 'idle'

  // W6/B10 — pause all orb animation when the tab is hidden.
  useEffect(() => {
    const onVis = () => setPaused(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    setPaused(document.hidden)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // W1/B7 ambient events + W5 haptics — from the real leads Realtime stream.
  useEffect(() => {
    if (!tenantId) return
    const supabase = createClient()
    const fire = (type: 'new' | 'booked', name: string) => {
      setEventKey((k) => {
        const key = k + 1
        setLastEvent({ key, type, name })
        return key
      })
      setPulse((p) => p + 1)
      try { navigator.vibrate?.(type === 'booked' ? [20, 40, 20] : 20) } catch { /* unsupported (iOS Safari) */ }
    }
    const ch = supabase
      .channel('rudi-presence')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads', filter: `tenant_id=eq.${tenantId}` }, (p) => {
        const l = p.new as { name?: string | null; phone?: string | null }
        fire('new', l.name || l.phone || 'New lead')
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads', filter: `tenant_id=eq.${tenantId}` }, (p) => {
        const l = p.new as { status?: string; name?: string | null; phone?: string | null }
        if (l.status === 'booked') fire('booked', l.name || l.phone || 'A customer')
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [tenantId])

  return <Ctx.Provider value={{ orbState, eventKey, paused, pulse, lastEvent }}>{children}</Ctx.Provider>
}

/** The orb, wired to the shared presence (state + one-shot ripple + pause). */
export function LiveOrb() {
  const { orbState, eventKey, paused } = useRudiPresence()
  return <AiOrb state={orbState} eventKey={eventKey} paused={paused} />
}

// B7 — ambient glass toasts. Each Realtime event floats up a frosted toast in a stack above
// the action row: rise+fade in, hold, drift up+fade out. Max 3, oldest removed first,
// pointer-events none. Reduced-motion → a brief static fade (handled by the CSS class).
interface Toast { key: number; type: 'new' | 'booked'; name: string }
export function GlassToasts() {
  const { lastEvent } = useRudiPresence()
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    if (!lastEvent) return
    setToasts((prev) => [...prev, { key: lastEvent.key, type: lastEvent.type, name: lastEvent.name }].slice(-3))
    const t = window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.key !== lastEvent.key)), 2900)
    return () => window.clearTimeout(t)
  }, [lastEvent])

  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 mb-2 flex flex-col items-center gap-2 md:hidden">
      {toasts.map((t) => (
        <div key={t.key} className="sx-toast flex max-w-[86%] items-center gap-2 rounded-xl border border-[#6366F1]/20 bg-white/75 px-3.5 py-2 shadow-e2 backdrop-blur-md">
          <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${t.type === 'booked' ? 'bg-emerald-50 text-emerald-600' : 'bg-[#6366F1]/10 text-[#6366F1]'}`}>
            {t.type === 'booked' ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />}
          </span>
          <span className="truncate text-[13px] font-medium text-ink">{t.type === 'booked' ? 'Appointment booked' : 'New lead'} · {t.name}</span>
        </div>
      ))}
    </div>
  )
}

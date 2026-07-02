'use client'

import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, PhoneOff, Volume2 } from 'lucide-react'
import { connectAvatar, type AvatarSession, type SpeakHandle } from '@/lib/brain/avatar'

const DNA_LABEL: Record<string, string> = { sales: 'Sales', pricing: 'Pricing', communication: 'Communication', customer: 'Customer', operations: 'Operations' }
const STEP_LABEL: Record<string, string> = { hero: 'Opening', understand: 'What I understand', focus: 'Where to focus', surprised: 'What surprised me', dna: 'Business DNA', questions: 'Still investigating' }

export interface LiveCooInsights {
  greeting: string
  study: { label: string; count: number }[]
  learned: { id: string; understanding_key: string; dna_strand: string; statement: string; business_confidence: number }[]
  execRecs: { id: string; title: string; narrative: string; impact: string; business_confidence: number }[]
  surprised: string[]
  topDna?: { dna_strand: string; strength: number }
  questions: string[]
  cooStatement: (key: string, fallback: string) => string
}

interface LiveCooProps {
  open: boolean
  portraitUrl: string
  segments: { text: string; section: string }[]
  audioUrl: string | null
  insights: LiveCooInsights
  onClose: () => void
}

export function LiveCoo({ open, portraitUrl, segments, audioUrl, insights, onClose }: LiveCooProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef<AvatarSession | null>(null)
  const handleRef = useRef<SpeakHandle | null>(null)
  const agendaRef = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const [ended, setEnded] = useState(false)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!open) return
    const stage = stageRef.current
    if (!stage) return
    let alive = true
    let session: AvatarSession | null = null
    setActive(0); setEnded(false); setBlocked(false); setPaused(false)
    connectAvatar(stage, { portraitUrl }).then((sess) => {
      if (!alive) { sess.destroy(); return }
      session = sess; sessionRef.current = sess
      handleRef.current = sess.speak({
        segments, audioUrl,
        onSegment: (i) => setActive(i),
        onEnd: () => setEnded(true),
        onBlocked: () => setBlocked(true),
      })
    })
    document.body.style.overflow = 'hidden'
    return () => {
      alive = false
      document.body.style.overflow = ''
      handleRef.current?.stop(); session?.destroy()
      sessionRef.current = null; handleRef.current = null
    }
  }, [open, portraitUrl, segments, audioUrl])

  // auto-scroll the active agenda step into view
  useEffect(() => {
    if (!agendaRef.current) return
    const el = agendaRef.current.querySelector<HTMLElement>(`[data-step="${active}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [active])

  if (!open) return null

  function togglePause() {
    const h = handleRef.current, s = sessionRef.current
    if (!h || !s) return
    if (paused) { h.resume(); s.setState('speaking'); setPaused(false); setBlocked(false) }
    else { h.pause(); s.setState('idle'); setPaused(true) }
  }
  function replay() {
    const s = sessionRef.current
    if (!s) return
    handleRef.current?.stop()
    setActive(0); setEnded(false); setPaused(false)
    handleRef.current = s.speak({ segments, audioUrl, onSegment: (i) => setActive(i), onEnd: () => setEnded(true), onBlocked: () => setBlocked(true) })
  }
  function tapToBegin() {
    handleRef.current?.resume(); sessionRef.current?.setState('speaking'); setBlocked(false); setPaused(false)
  }

  const seg = segments[active]

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#05070f]/95 backdrop-blur-xl">
      {/* top bar */}
      <div className="flex items-center justify-between px-5 py-3 text-white/80">
        <span className="flex items-center gap-2 text-xs font-medium"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Live · Your AI COO</span>
        <button onClick={onClose} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"><PhoneOff className="h-3.5 w-3.5" /> End</button>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-4 overflow-hidden px-4 pb-4 lg:grid-cols-[1.15fr_1fr] lg:grid-rows-1">
        {/* COO stage — dominates the experience */}
        <div className="relative min-h-[42vh] overflow-hidden rounded-3xl shadow-e2 ring-1 ring-white/10">
          <div ref={stageRef} className="absolute inset-0 rounded-3xl" />
          {/* live caption */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-5 pt-14">
            <p className="text-[15px] leading-relaxed text-white drop-shadow sm:text-base">{seg?.text}</p>
          </div>
          {blocked && (
            <button onClick={tapToBegin} className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-white">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20"><Volume2 className="h-6 w-6" /></span>
              <span className="text-sm font-medium">Tap to begin the briefing</span>
            </button>
          )}
        </div>

        {/* insight column — cards illuminate one-by-one as he speaks */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white/[0.03] p-4 ring-1 ring-white/10">
          <div className="mb-3 flex items-center justify-between text-white/70">
            <span className="text-xs font-semibold uppercase tracking-wide">Morning executive meeting</span>
            <span className="text-xs tabular-nums">{Math.min(active + 1, segments.length)} / {segments.length}</span>
          </div>

          {/* active illuminated insight */}
          <div key={active} className="spotlight-in">
            <ActiveCard section={seg?.section} insights={insights} />
          </div>

          {/* agenda — auto-scrolls, past dimmed, current lit */}
          <div ref={agendaRef} className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {segments.map((sg, i) => (
              <div key={i} data-step={i} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-all ${i === active ? 'bg-accent/20 text-white' : i < active ? 'text-white/35' : 'text-white/25'}`}>
                <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${i === active ? 'bg-accent' : i < active ? 'bg-white/30' : 'bg-white/15'}`} />
                {STEP_LABEL[sg.section] || 'Briefing'}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* controls */}
      <div className="flex items-center justify-center gap-3 pb-6 pt-1">
        {ended ? (
          <>
            <button onClick={replay} className="flex items-center gap-1.5 rounded-full bg-white/15 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/25"><RotateCcw className="h-4 w-4" /> Replay</button>
            <button onClick={onClose} className="flex items-center gap-1.5 rounded-full bg-red-500/90 px-5 py-2.5 text-sm font-medium text-white hover:bg-red-500"><PhoneOff className="h-4 w-4" /> End meeting</button>
          </>
        ) : (
          <>
            <button onClick={togglePause} className="flex items-center gap-1.5 rounded-full bg-white/15 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/25">{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}{paused ? 'Resume' : 'Pause'}</button>
            <button onClick={replay} className="flex items-center gap-1.5 rounded-full bg-white/15 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/25"><RotateCcw className="h-4 w-4" /> Replay</button>
            <button onClick={onClose} className="flex items-center gap-1.5 rounded-full bg-red-500/90 px-5 py-2.5 text-sm font-medium text-white hover:bg-red-500"><PhoneOff className="h-4 w-4" /> End</button>
          </>
        )}
      </div>
    </div>
  )
}

function ActiveCard({ section, insights }: { section?: string; insights: LiveCooInsights }) {
  const { learned, execRecs, surprised, topDna, questions, study, greeting, cooStatement } = insights
  switch (section) {
    case 'understand': { const u = learned[0]; if (!u) break; return (
      <Card label="What I understand" glow="blue"><p className="text-base font-medium text-ink">{cooStatement(u.understanding_key, u.statement)}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]"><span className="rounded-md bg-accent/10 px-2 py-0.5 font-medium text-accent-strong">{DNA_LABEL[u.dna_strand]} DNA</span><span className={`rounded-md px-2 py-0.5 font-medium ${u.business_confidence >= 65 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>Business Confidence {u.business_confidence}%</span></div></Card>) }
    case 'focus': { const r = execRecs[0]; if (!r) break; return (
      <Card label={"Where I'd focus"} glow="blue"><p className="text-base font-semibold text-ink">{r.title}</p><p className="mt-1 text-sm text-muted">{r.narrative}</p>
        <div className="mt-2.5 rounded-lg bg-sunken p-2.5 text-xs text-ink"><span className="font-medium text-subtle">Estimated impact — </span>{r.impact}</div></Card>) }
    case 'surprised': { const t = surprised[0]; if (!t) break; return (
      <Card label="What surprised me" glow="amber"><p className="text-sm text-ink">{t}</p></Card>) }
    case 'dna': { const d = topDna; if (!d || d.strength <= 0) break; return (
      <Card label="Your Business DNA" glow="blue"><div className="flex items-center justify-between"><span className="text-sm font-medium text-ink">{DNA_LABEL[d.dna_strand]} DNA</span><span className="text-xs tabular-nums text-subtle">{d.strength}%</span></div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-gradient-to-r from-accent to-[#A855F7]" style={{ width: `${Math.max(3, d.strength)}%` }} /></div></Card>) }
    case 'questions': { const q = questions[0]; if (!q) break; return (
      <Card label={"Still investigating"} glow="blue"><p className="text-sm text-ink">{q}</p></Card>) }
  }
  // opening / fallback
  return (
    <Card label={greeting} glow="blue">
      <p className="text-sm text-ink">I studied your business while you were away. Here&apos;s what I understand better today.</p>
      {study.length > 0 && <div className="mt-2.5 flex flex-wrap gap-1.5">{study.slice(0, 4).map((x) => <span key={x.label} className="rounded-md bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent-strong">{x.count} {x.label}</span>)}</div>}
    </Card>
  )
}

function Card({ label, glow, children }: { label: string; glow: 'blue' | 'amber'; children: React.ReactNode }) {
  const g = glow === 'amber' ? 'shadow-[0_0_70px_rgba(245,158,11,0.45)] bg-amber-50' : 'shadow-[0_0_70px_rgba(91,108,240,0.55)] bg-white'
  const l = glow === 'amber' ? 'text-amber-700' : 'text-accent-strong'
  return (
    <div className={`rounded-2xl p-4 ring-1 ring-white/60 ${g}`}>
      <p className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide ${l}`}>{label}</p>
      {children}
    </div>
  )
}

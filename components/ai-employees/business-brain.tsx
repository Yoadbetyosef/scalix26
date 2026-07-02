'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Brain, Sparkles, TrendingUp, Search, HelpCircle, ShieldCheck, ArrowRight, Volume2, Square } from 'lucide-react'
import { priorityOf, PRIORITY_META, cooStatement, estimatedImpact, dnaLine, openQuestions, type Priority } from '@/lib/brain/present'

interface Dna { dna_strand: string; strength: number }
interface Understanding { id: string; dna_strand: string; understanding_key: string; title: string; statement: string; business_confidence: number; evidence_strength: string; evidence_summary: string }
interface Rec { id: string; understanding_id: string; category: string; title: string; why: string; how: string; if_ignored: string; business_confidence: number; evidence_strength: string }
interface Pattern { pattern_key: string; metric_value: number | null }
interface Update { kind: string; dna_strand: string | null; title: string; detail: string | null; delta: number | null; created_at: string }
interface BrainState { dna: Dna[]; understandings: Understanding[]; recommendations: Rec[]; patterns: Pattern[]; updates: Update[]; learnedCount: number }

const DNA_LABEL: Record<string, string> = { sales: 'Sales', pricing: 'Pricing', communication: 'Communication', customer: 'Customer', operations: 'Operations' }
const DNA_ORDER = ['sales', 'pricing', 'communication', 'customer', 'operations']
const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'watching', 'learning']
const updIcon = (k: string) => (k === 'dna_up' ? TrendingUp : k === 'confidence_up' ? ShieldCheck : Search)

export function BusinessBrain({ agentId }: { agentId: string; agentName?: string }) {
  const [s, setS] = useState<BrainState | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [tick, setTick] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let on = true
    fetch(`/api/brain/${agentId}`).then((r) => r.json()).then((d) => { if (on) { setS(d); setLoading(false) } }).catch(() => on && setLoading(false))
    return () => { on = false }
  }, [agentId])

  // Living DNA — cycle the "learning…" lines so the Brain feels alive.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2600)
    return () => clearInterval(id)
  }, [])

  // Stop any spoken briefing when leaving the page.
  useEffect(() => () => { audioRef.current?.pause() }, [])

  async function run() {
    setRunning(true)
    try {
      const r = await fetch(`/api/brain/run/${agentId}`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'failed')
      const fresh = await (await fetch(`/api/brain/${agentId}`)).json()
      setS(fresh)
      toast.success(j.changes > 0 ? `I learned ${j.changes} new thing${j.changes === 1 ? '' : 's'}` : 'I studied your business again')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not study your business')
    } finally { setRunning(false) }
  }

  const understandings = s?.understandings || []
  const hasAnything = understandings.length > 0 || (s?.dna || []).some((d) => d.strength > 0)
  const uById = new Map(understandings.map((u) => [u.id, u]))
  const patternVal = (k: string) => s?.patterns.find((p) => p.pattern_key === k)?.metric_value ?? null

  const execRecs = (s?.recommendations || []).map((r) => {
    const u = uById.get(r.understanding_id)
    const key = u?.understanding_key || ''
    return { ...r, key, priority: priorityOf(r.business_confidence, r.category), narrative: cooStatement(key, u?.statement || r.why), impact: estimatedImpact(key, patternVal, r.business_confidence) }
  })
  const weakStrands = (s?.dna || []).filter((d) => d.strength < 30).map((d) => d.dna_strand)
  const questions = openQuestions(understandings.map((u) => u.understanding_key), weakStrands)

  // The COO's spoken briefing — natural language composed from the same real data.
  function spokenBriefing(): string {
    if (!hasAnything) return "I haven't studied your business yet. Give me a moment with your data and I'll tell you what I find."
    const b: string[] = [`I've been studying your business. So far I've understood ${s?.learnedCount ?? 0} things about how you work, and I get sharper every day.`]
    const top = execRecs[0]
    if (top) { b.push(`Here's what I'd focus on first. ${top.title}. ${top.narrative}`); if (!/not enough/i.test(top.impact)) b.push(top.impact) }
    if (execRecs[1]) b.push(`I'd also keep an eye on this: ${execRecs[1].title}.`)
    const topDna = [...(s?.dna || [])].sort((a, z) => z.strength - a.strength)[0]
    if (topDna && topDna.strength > 0) b.push(`Your strongest area is ${DNA_LABEL[topDna.dna_strand]} DNA, at ${topDna.strength} percent. I'm still building the others as more data comes in.`)
    if (questions[0]) b.push(`I'm still figuring out ${questions[0]}. I'll keep watching before I make a call.`)
    b.push("That's my read for now. I'll let you know the moment something changes.")
    return b.join(' ')
  }

  function speak() {
    if (speaking) { audioRef.current?.pause(); audioRef.current = null; setSpeaking(false); return }
    const a = new Audio(`/api/tts?text=${encodeURIComponent(spokenBriefing())}&voice=aura-2-asteria-en`)
    audioRef.current = a
    a.onended = () => setSpeaking(false)
    a.onerror = () => { setSpeaking(false); toast.error("I couldn't say that out loud right now.") }
    a.play().then(() => setSpeaking(true)).catch(() => { setSpeaking(false); toast.error("I couldn't say that out loud right now.") })
  }

  return (
    <div className="space-y-6">
      {/* Living header — the COO greets you */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0e1330] to-[#1b2450] p-5 text-white shadow-e2">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-white/10"><Brain className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">Business Brain</p>
            <p className="text-sm text-white/70">
              {running ? "I'm studying your business…" : hasAnything
                ? `I've understood ${s?.learnedCount ?? 0} things about how your business works — and I get sharper every day.`
                : 'Let me study your business from the data you already have.'}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {hasAnything && (
              <button onClick={speak} className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-white transition-colors ${speaking ? 'bg-white/25' : 'bg-white/15 hover:bg-white/25'}`}>
                {speaking ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-4 w-4" />}
                {speaking ? 'Stop' : 'Hear my briefing'}
              </button>
            )}
            <Button onClick={run} loading={running} className="bg-white text-[#1b2450] hover:bg-white/90">
              {hasAnything ? 'Study again' : 'Study my business'}
            </Button>
          </div>
        </div>
      </div>

      {loading && <p className="text-sm text-muted">Opening your Business Brain…</p>}

      {!loading && !hasAnything && (
        <div className="rounded-2xl border border-hairline bg-white p-6 text-center">
          <Sparkles className="mx-auto h-6 w-6 text-accent-strong" />
          <p className="mt-2 text-sm font-medium text-ink">I haven&apos;t studied your business yet.</p>
          <p className="mt-1 text-xs text-muted">Give me a moment with your conversations, bookings, and payments and I&apos;ll start understanding how you actually work.</p>
        </div>
      )}

      {hasAnything && (
        <>
          {/* What changed today */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">What changed today</h2>
            {(s?.updates || []).length === 0 ? (
              <div className="rounded-xl border border-hairline bg-white p-3.5 text-sm text-muted">No meaningful changes today — I&apos;m still watching.</div>
            ) : (
              <div className="space-y-2">
                {s!.updates.map((u, i) => {
                  const Icon = updIcon(u.kind)
                  return (
                    <div key={i} className="flex items-start gap-2.5 rounded-xl border border-hairline bg-white p-3">
                      <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600"><Icon className="h-3.5 w-3.5" /></span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{u.title}{u.delta ? <span className="text-emerald-600"> +{u.delta}%</span> : null}</p>
                        {u.detail && <p className="text-xs text-muted">{u.detail}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Executive Priorities */}
          {execRecs.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-ink">What I&apos;d focus on</h2>
              <div className="space-y-4">
                {PRIORITY_ORDER.map((prio) => {
                  const items = execRecs.filter((r) => r.priority === prio)
                  if (!items.length) return null
                  const meta = PRIORITY_META[prio]
                  return (
                    <div key={prio}>
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${meta.tone}`}>{meta.label}</span>
                      </div>
                      <div className="space-y-3">
                        {items.map((r) => (
                          <div key={r.id} className="rounded-2xl border border-hairline bg-white p-4 shadow-e1">
                            <p className="text-[15px] font-semibold text-ink">{r.title}</p>
                            <p className="mt-1 text-sm text-muted">{r.narrative}</p>
                            <div className="mt-2.5 rounded-lg bg-sunken p-2.5">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-subtle">Estimated impact</p>
                              <p className="text-xs text-ink">{r.impact}</p>
                            </div>
                            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
                              <span className={`rounded-md px-2 py-0.5 font-medium ${r.business_confidence >= 65 ? 'bg-emerald-50 text-emerald-700' : r.business_confidence >= 35 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>Business Confidence {r.business_confidence}%</span>
                              <span className="text-subtle">{r.evidence_strength} evidence · {uById.get(r.understanding_id)?.evidence_summary}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Business DNA — alive */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">Your Business DNA</h2>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {DNA_ORDER.map((strand) => {
                const d = (s?.dna || []).find((x) => x.dna_strand === strand)
                const strength = d?.strength || 0
                return (
                  <div key={strand} className="rounded-xl border border-hairline bg-white p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-ink">{DNA_LABEL[strand]} DNA</span>
                      <span className="text-xs tabular-nums text-subtle">{strength}%</span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full bg-gradient-to-r from-accent to-[#A855F7] transition-[width] duration-700" style={{ width: `${Math.max(3, strength)}%` }} />
                    </div>
                    <p className="mt-1.5 text-[11px] italic text-subtle">{dnaLine(strand, strength, tick)}</p>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Questions I'm trying to answer */}
          {questions.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink"><HelpCircle className="h-4 w-4 text-accent-strong" /> Questions I&apos;m trying to answer</h2>
              <div className="rounded-xl border border-hairline bg-white p-4">
                <p className="mb-2 text-xs text-muted">I&apos;m still figuring these out — I&apos;ll keep watching before I make a call:</p>
                <ul className="space-y-1.5">
                  {questions.map((q, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-ink"><ArrowRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-subtle" />{q}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

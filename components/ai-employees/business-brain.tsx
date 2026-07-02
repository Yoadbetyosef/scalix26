'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Volume2, TrendingUp, Search, ArrowRight, Check, Lightbulb, Clock, HelpCircle, Wand2, DollarSign, MessageCircle } from 'lucide-react'
import { priorityOf, PRIORITY_META, cooStatement, estimatedImpact, dnaLine, openQuestions, studyLines, surprisedMe, COMING_NEXT, ASK_QUESTIONS, answerCooQuestion, type Priority, type Sources } from '@/lib/brain/present'
import type { BrainView } from '@/lib/brain/view'
import { LiveCoo } from './live-coo'

interface Dna { dna_strand: string; strength: number }
interface Understanding { id: string; dna_strand: string; understanding_key: string; title: string; statement: string; business_confidence: number; evidence_strength: string; evidence_summary: string }
interface Rec { id: string; understanding_id: string; category: string; title: string; why: string; how: string; if_ignored: string; business_confidence: number; evidence_strength: string }
interface Pattern { pattern_key: string; metric_value: number | null }
interface Update { kind: string; dna_strand: string | null; title: string; detail: string | null; delta: number | null; created_at: string }
interface FinVis { percent: number; connected: string[]; missing: string[]; note: string }
interface BrainState { dna: Dna[]; understandings: Understanding[]; recommendations: Rec[]; patterns: Pattern[]; updates: Update[]; sources: Sources; dnaWeekDelta: Record<string, number>; lastLearned: string | null; financialVisibility: FinVis; learnedCount: number }
interface Seg { text: string; section: string }

const DNA_LABEL: Record<string, string> = { sales: 'Sales', pricing: 'Pricing', communication: 'Communication', customer: 'Customer', operations: 'Operations' }
const DNA_ORDER = ['sales', 'pricing', 'communication', 'customer', 'operations']
const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'watching', 'learning']
const updIcon = (k: string) => (k === 'dna_up' ? TrendingUp : k === 'confidence_up' ? Check : Search)
function timeAgo(iso: string | null): string {
  if (!iso) return 'just now'
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'moments ago'; if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  return `${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? '' : 's'} ago`
}
function greeting(): string { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }

export function BusinessBrain({ agentId }: { agentId: string; agentName?: string }) {
  const [s, setS] = useState<BrainState | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [tick, setTick] = useState(0)
  const [ask, setAsk] = useState<{ q: string; a: string } | null>(null)
  // Morning Executive Meeting — a live "FaceTime" briefing rendered by <LiveCoo>. This
  // component only fetches the (cached) briefing text + audio and opens the overlay; all the
  // avatar animation + playback lives behind the swappable avatar provider.
  const [briefingLoad, setBriefingLoad] = useState(false)
  const [briefingOpen, setBriefingOpen] = useState(false)
  const [briefingData, setBriefingData] = useState<{ segments: Seg[]; audioUrl: string | null }>({ segments: [], audioUrl: null })

  useEffect(() => {
    let on = true
    fetch(`/api/brain/${agentId}`).then((r) => r.json()).then((d) => { if (on) { setS(d); setLoading(false) } }).catch(() => on && setLoading(false))
    return () => { on = false }
  }, [agentId])
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 2600); return () => clearInterval(id) }, [])

  async function run() {
    setRunning(true)
    try {
      const r = await fetch(`/api/brain/run/${agentId}`, { method: 'POST' }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setS(await (await fetch(`/api/brain/${agentId}`)).json())
      toast.success(j.changes > 0 ? `I learned ${j.changes} new thing${j.changes === 1 ? '' : 's'}` : 'I studied your business again')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not study your business') } finally { setRunning(false) }
  }

  async function startBriefing() {
    setBriefingLoad(true)
    try {
      const r = await fetch(`/api/brain/briefing/${agentId}`, { method: 'POST' }); const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'failed')
      setBriefingData({ segments: j.segments || [], audioUrl: j.audio || null })
      setBriefingOpen(true)
    } catch { toast.error("I couldn't start the briefing right now.") } finally { setBriefingLoad(false) }
  }

  const understandings = s?.understandings || []
  const hasAnything = understandings.length > 0 || (s?.dna || []).some((d) => d.strength > 0)
  const uById = new Map(understandings.map((u) => [u.id, u]))
  const patternVal = (k: string) => s?.patterns.find((p) => p.pattern_key === k)?.metric_value ?? null
  const learned = understandings.filter((u) => u.business_confidence >= 40)
  const needsEvidence = understandings.filter((u) => u.business_confidence < 40)
  const surprised = surprisedMe(patternVal)
  const execRecs = (s?.recommendations || []).map((r) => { const u = uById.get(r.understanding_id); const key = u?.understanding_key || ''; return { ...r, key, priority: priorityOf(r.business_confidence, r.category), narrative: cooStatement(key, u?.statement || r.why), impact: estimatedImpact(key, patternVal, r.business_confidence) } })
  const weakStrands = (s?.dna || []).filter((d) => d.strength < 30).map((d) => d.dna_strand)
  const questions = openQuestions(understandings.map((u) => u.understanding_key), weakStrands)
  const topDna = [...(s?.dna || [])].sort((a, b) => b.strength - a.strength)[0]
  const study = studyLines(s?.sources || { total: 0, voice: 0, sms: 0, email: 0, facebook: 0, instagram: 0, whatsapp: 0 })
  const fv = s?.financialVisibility
  const sec = (_key: string) => '' // section highlighting now happens inside the LiveCoo overlay

  function askQ(key: string, q: string) { setAsk({ q, a: s ? answerCooQuestion(key, s as unknown as BrainView) : 'One moment…' }) }

  return (
    <div className="space-y-7">
      {/* HERO — the always-mounted COO. Clicking "Hear my briefing" opens the live meeting. */}
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#0d1230] via-[#141b40] to-[#241a48] p-6 text-white shadow-e2 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="relative mx-auto flex-shrink-0 sm:mx-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/avatars/coo.png" alt="Your AI COO" className="relative h-20 w-20 rounded-full object-cover ring-2 ring-white/20" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xl font-semibold sm:text-2xl">{greeting()}.</p>
            <p className="mt-0.5 text-sm text-white/75">{running ? "I'm studying your business right now…" : hasAnything ? `I've been studying your business — last time ${timeAgo(s?.lastLearned || null)}. Here's what I understand better today.` : 'Let me study your business from the data you already have.'}</p>
            {hasAnything && study.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">{study.map((x) => <span key={x.label} className="inline-flex items-center gap-1.5 text-xs text-white/80"><Check className="h-3.5 w-3.5 text-emerald-300" />{x.count} {x.label}</span>)}</div>
            )}
          </div>
          <div className="flex flex-shrink-0 flex-col gap-2 sm:items-end">
            {hasAnything && <button onClick={startBriefing} disabled={briefingLoad} className="flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3.5 text-xs font-medium text-white transition-colors hover:bg-white/25 disabled:opacity-60"><Volume2 className="h-4 w-4" />{briefingLoad ? 'Preparing…' : 'Hear my briefing'}</button>}
            <Button onClick={run} loading={running} className="bg-white text-[#1b2450] hover:bg-white/90">{hasAnything ? 'Study again' : 'Study my business'}</Button>
          </div>
        </div>
      </div>

      <LiveCoo
        open={briefingOpen}
        portraitUrl="/avatars/coo.png"
        segments={briefingData.segments}
        audioUrl={briefingData.audioUrl}
        insights={{ greeting: `${greeting()}.`, study, learned, execRecs, surprised, topDna, questions, cooStatement }}
        onClose={() => setBriefingOpen(false)}
      />

      {loading && <p className="text-sm text-muted">Opening your Business Brain…</p>}
      {!loading && !hasAnything && (
        <div className="rounded-2xl border border-hairline bg-white p-6 text-center"><p className="text-sm font-medium text-ink">I haven&apos;t studied your business yet.</p><p className="mt-1 text-xs text-muted">Give me a moment with your conversations, bookings, and payments and I&apos;ll start understanding how you actually work.</p></div>
      )}

      {hasAnything && (
        <>
          {/* STATUS + FINANCIAL VISIBILITY */}
          <div className={`rounded-2xl border border-hairline bg-white p-4 ${sec('status')}`}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
              <span className="flex items-center gap-1.5 font-medium text-ink"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Studying your business</span>
              <span className="text-muted">Last learned {timeAgo(s?.lastLearned || null)}</span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-subtle">Learning from</p><div className="flex flex-wrap gap-1.5">{study.map((x) => <span key={x.label} className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{x.label}</span>)}</div></div>
              <div><p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-subtle">Coming next — each gives me another sense</p><div className="flex flex-wrap gap-1.5">{COMING_NEXT.map((x) => <span key={x} className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{x}</span>)}</div></div>
            </div>
            {fv && (
              <div className="mt-3 rounded-xl bg-gradient-to-br from-[#EEF1FE] to-[#F4EEFB] p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-ink"><DollarSign className="h-3.5 w-3.5 text-accent-strong" /> Financial Visibility</span>
                  <span className="text-xs font-semibold tabular-nums text-ink">{fv.percent}%</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/70"><div className="h-full rounded-full bg-gradient-to-r from-accent to-[#A855F7]" style={{ width: `${Math.max(3, fv.percent)}%` }} /></div>
                <p className="mt-1.5 text-[11px] text-muted">{fv.note}</p>
                {fv.missing.length > 0 && <p className="mt-1 text-[11px] text-subtle">Connect to see more: {fv.missing.slice(0, 4).join(', ')}</p>}
              </div>
            )}
          </div>

          {/* WHAT CHANGED TODAY */}
          <div className={sec('changed')}><Section title="What changed today" icon={TrendingUp}>
            {(s?.updates || []).length === 0 ? <div className="rounded-xl border border-hairline bg-white p-3.5 text-sm text-muted">No meaningful changes today — I&apos;m still watching.</div> : (
              <div className="space-y-2">{s!.updates.slice(0, 5).map((u, i) => { const Icon = updIcon(u.kind); return (<div key={i} className="flex items-start gap-2.5 rounded-xl border border-hairline bg-white p-3"><span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600"><Icon className="h-3.5 w-3.5" /></span><div className="min-w-0"><p className="text-sm font-medium text-ink">{u.title}{u.delta ? <span className="text-emerald-600"> +{u.delta}%</span> : null}</p>{u.detail && <p className="text-xs text-muted">{u.detail}</p>}</div></div>) })}</div>
            )}
          </Section></div>

          {/* WHAT I UNDERSTAND */}
          {learned.length > 0 && <div className={sec('understand')}><Section title="What I understand about your business" icon={Lightbulb}>
            <div className="space-y-2.5">{learned.map((u) => (<div key={u.id} className="rounded-xl border border-hairline bg-white p-4"><p className="text-[15px] font-medium text-ink">{cooStatement(u.understanding_key, u.statement)}</p><div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]"><span className="rounded-md bg-accent/10 px-2 py-0.5 font-medium text-accent-strong">{DNA_LABEL[u.dna_strand]} DNA</span><span className={`rounded-md px-2 py-0.5 font-medium ${u.business_confidence >= 65 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>Business Confidence {u.business_confidence}%</span><span className="text-subtle">{u.evidence_summary}</span></div></div>))}</div>
          </Section></div>}

          {/* WHAT SURPRISED ME */}
          {surprised.length > 0 && <div className={sec('surprised')}><Section title="What surprised me" icon={Search}>
            <div className="space-y-2">{surprised.map((t, i) => <div key={i} className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-ink">{t}</div>)}</div>
          </Section></div>}

          {/* NEEDS MORE EVIDENCE */}
          {needsEvidence.length > 0 && <div className={sec('needs')}><Section title="What still needs more evidence" icon={HelpCircle}>
            <div className="space-y-2">{needsEvidence.map((u) => (<div key={u.id} className="rounded-xl border border-hairline bg-white p-3.5"><p className="text-sm text-ink">{cooStatement(u.understanding_key, u.statement)}</p><p className="mt-1 text-[11px] text-subtle">Only {u.business_confidence}% confident so far · {u.evidence_summary} — I&apos;ll keep watching before I recommend anything.</p></div>))}</div>
          </Section></div>}

          {/* FOCUS */}
          {execRecs.length > 0 && <div className={sec('focus')}><Section title="Here's what I'd focus on">
            <div className="space-y-4">{PRIORITY_ORDER.map((prio) => { const items = execRecs.filter((r) => r.priority === prio); if (!items.length) return null; const meta = PRIORITY_META[prio]; return (
              <div key={prio}><div className="mb-1.5 flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} /><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${meta.tone}`}>{meta.label}</span></div>
                <div className="space-y-3">{items.map((r) => (<div key={r.id} className="rounded-2xl border border-hairline bg-white p-4 shadow-e1"><p className="text-[15px] font-semibold text-ink">{r.title}</p><p className="mt-1 text-sm text-muted">{r.narrative}</p><div className="mt-2.5 rounded-lg bg-sunken p-2.5"><p className="text-[11px] font-medium uppercase tracking-wide text-subtle">Estimated impact</p><p className="text-xs text-ink">{r.impact}</p></div><div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]"><span className={`rounded-md px-2 py-0.5 font-medium ${r.business_confidence >= 65 ? 'bg-emerald-50 text-emerald-700' : r.business_confidence >= 35 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>Business Confidence {r.business_confidence}%</span><span className="text-subtle">{r.evidence_strength} evidence · {uById.get(r.understanding_id)?.evidence_summary}</span></div></div>))}</div>
              </div>) })}</div>
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/5 p-3 text-xs text-ink"><Wand2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-strong" /><span>When I become confident enough, I&apos;ll go further on my own — suggesting improvements to your sales script, objection handling, and how leads get qualified. I&apos;ll always show you first.</span></div>
          </Section></div>}

          {/* ASK MY COO */}
          <div className={sec('ask')}><Section title="Ask my COO" icon={MessageCircle}>
            <div className="rounded-2xl border border-hairline bg-white p-4">
              <div className="flex flex-wrap gap-2">{ASK_QUESTIONS.map((x) => <button key={x.key} onClick={() => askQ(x.key, x.q)} className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${ask?.q === x.q ? 'border-accent bg-accent/10 text-accent-strong' : 'border-hairline text-muted hover:bg-sunken'}`}>{x.q}</button>)}</div>
              {ask && (<div className="mt-3 rounded-xl bg-sunken p-3.5"><p className="text-xs font-medium text-subtle">{ask.q}</p><p className="mt-1 text-sm text-ink">{ask.a}</p></div>)}
              <p className="mt-2 text-[11px] text-subtle">I answer only from what I&apos;ve actually seen. If I don&apos;t have the data, I&apos;ll tell you.</p>
            </div>
          </Section></div>

          {/* DNA */}
          <div className={sec('dna')}><Section title="Your Business DNA">
            <div className="grid gap-2.5 sm:grid-cols-2">{DNA_ORDER.map((strand) => { const d = (s?.dna || []).find((x) => x.dna_strand === strand); const strength = d?.strength || 0; const wk = s?.dnaWeekDelta?.[strand] || 0; return (
              <div key={strand} className="rounded-xl border border-hairline bg-white p-3.5"><div className="flex items-center justify-between"><span className="text-sm font-medium text-ink">{DNA_LABEL[strand]} DNA</span><span className="flex items-center gap-1.5 text-xs tabular-nums text-subtle">{wk > 0 && <span className="text-emerald-600">↑ +{wk} this week</span>}{strength}%</span></div><div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-gradient-to-r from-accent to-[#A855F7] transition-[width] duration-700" style={{ width: `${Math.max(3, strength)}%` }} /></div><p className="mt-1.5 text-[11px] italic text-subtle">{dnaLine(strand, strength, tick)}</p></div>) })}</div>
          </Section></div>

          {/* TIMELINE */}
          {(s?.updates || []).length > 0 && <div className={sec('timeline')}><Section title="Timeline" icon={Clock}>
            <div className="rounded-xl border border-hairline bg-white p-4"><ol className="space-y-3">{s!.updates.slice(0, 8).map((u, i) => (<li key={i} className="flex gap-3"><span className="w-14 flex-shrink-0 pt-0.5 text-[11px] tabular-nums text-subtle">{new Date(u.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" /><span className="min-w-0 text-sm text-ink">{u.title}{u.delta ? <span className="text-emerald-600"> (+{u.delta}%)</span> : null}{u.detail ? <span className="text-muted"> — {u.detail}</span> : null}</span></li>))}</ol></div>
          </Section></div>}

          {/* QUESTIONS */}
          {questions.length > 0 && <div className={sec('questions')}><Section title="I'm still investigating…" icon={HelpCircle}>
            <div className="rounded-xl border border-hairline bg-white p-4"><ul className="space-y-1.5">{questions.map((q, i) => <li key={i} className="flex items-start gap-2 text-sm text-ink"><ArrowRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-subtle" />{q}<span className="text-subtle"> — I&apos;ll keep watching before I make a call.</span></li>)}</ul></div>
          </Section></div>}
        </>
      )}
    </div>
  )
}

function Section({ title, icon: Icon, children }: { title: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-ink">{Icon && <Icon className="h-4 w-4 text-accent-strong" />}{title}</h2>
      {children}
    </section>
  )
}

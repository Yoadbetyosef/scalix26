'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Brain, Sparkles, ArrowRight, ShieldCheck } from 'lucide-react'

interface Dna { dna_strand: string; strength: number; evidence_count: number }
interface Understanding { id: string; dna_strand: string; title: string; statement: string; business_confidence: number; evidence_strength: string; evidence_summary: string }
interface Rec { id: string; category: string; title: string; why: string; how: string; if_ignored: string; estimated_impact: string | null; business_confidence: number; evidence_strength: string }
interface BrainState { dna: Dna[]; understandings: Understanding[]; recommendations: Rec[]; learnedCount: number }

const DNA_LABEL: Record<string, string> = { sales: 'Sales DNA', pricing: 'Pricing DNA', communication: 'Communication DNA', customer: 'Customer DNA', operations: 'Operations DNA' }
const ORDER = ['sales', 'pricing', 'communication', 'customer', 'operations']

const confTone = (c: number) => (c >= 65 ? 'bg-emerald-50 text-emerald-700' : c >= 35 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500')

export function BusinessBrain({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [s, setS] = useState<BrainState | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    let on = true
    fetch(`/api/brain/${agentId}`).then((r) => r.json()).then((d) => { if (on) { setS(d); setLoading(false) } }).catch(() => on && setLoading(false))
    return () => { on = false }
  }, [agentId])

  async function run() {
    setRunning(true)
    try {
      const r = await fetch(`/api/brain/run/${agentId}`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'failed')
      const fresh = await (await fetch(`/api/brain/${agentId}`)).json()
      setS(fresh)
      toast.success('Your Business Brain got smarter')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not run the Brain')
    } finally { setRunning(false) }
  }

  const dnaByStrand = new Map((s?.dna || []).map((d) => [d.dna_strand, d]))
  const hasAnything = (s?.understandings.length || 0) > 0 || (s?.dna || []).some((d) => d.strength > 0)

  return (
    <div className="space-y-6">
      {/* Status header */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0e1330] to-[#1b2450] p-5 text-white shadow-e2">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-white/10"><Brain className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">{agentName}&apos;s Business Brain</p>
            <p className="text-sm text-white/70">
              {running ? 'Building your Business Brain…' : hasAnything ? `Has learned ${s?.learnedCount ?? 0} things about how your business works.` : 'Ready to study your business from the data you already have.'}
            </p>
          </div>
          <Button onClick={run} loading={running} className="flex-shrink-0 bg-white text-[#1b2450] hover:bg-white/90">
            {hasAnything ? 'Update Brain' : 'Run Brain Analysis'}
          </Button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted">Opening your Business Brain…</p>}

      {!loading && !hasAnything && (
        <div className="rounded-2xl border border-hairline bg-white p-6 text-center">
          <Sparkles className="mx-auto h-6 w-6 text-accent-strong" />
          <p className="mt-2 text-sm font-medium text-ink">Your Business Brain is empty — for now.</p>
          <p className="mt-1 text-xs text-muted">Run the first analysis and it will start understanding how your business works from your conversations, bookings, and payments.</p>
        </div>
      )}

      {hasAnything && (
        <>
          {/* Business DNA */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">Your Business DNA</h2>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {ORDER.map((strand) => {
                const d = dnaByStrand.get(strand)
                const strength = d?.strength || 0
                return (
                  <div key={strand} className="rounded-xl border border-hairline bg-white p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-ink">{DNA_LABEL[strand]}</span>
                      <span className="text-xs tabular-nums text-subtle">{strength}%</span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full bg-gradient-to-r from-accent to-[#7E9DEF] transition-[width] duration-700" style={{ width: `${Math.max(3, strength)}%` }} />
                    </div>
                    <p className="mt-1.5 text-[11px] text-subtle">{strength >= 60 ? 'Strong understanding' : strength > 0 ? 'Getting stronger' : 'Not enough evidence yet'}</p>
                  </div>
                )
              })}
            </div>
          </section>

          {/* What the Brain understands */}
          {!!s?.understandings.length && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-ink">What your Brain understands</h2>
              <div className="space-y-2.5">
                {s.understandings.map((u) => (
                  <div key={u.id} className="rounded-xl border border-hairline bg-white p-4">
                    <p className="text-[15px] font-medium text-ink">{u.statement}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded-md bg-accent/10 px-2 py-0.5 font-medium text-accent-strong">{DNA_LABEL[u.dna_strand]}</span>
                      <span className={`rounded-md px-2 py-0.5 font-medium ${confTone(u.business_confidence)}`}>Business Confidence {u.business_confidence}%</span>
                      <span className="text-subtle">{u.evidence_strength} evidence · {u.evidence_summary}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* What the COO recommends */}
          {!!s?.recommendations.length && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-ink">What your AI COO recommends</h2>
              <div className="space-y-3">
                {s.recommendations.map((r) => (
                  <div key={r.id} className="rounded-2xl border border-hairline bg-white p-4 shadow-e1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-ink">{r.title}</p>
                      <span className={`flex-shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${confTone(r.business_confidence)}`}>{r.business_confidence}%</span>
                    </div>
                    <dl className="mt-2 space-y-1.5 text-xs">
                      <div><dt className="inline font-medium text-ink">Why: </dt><dd className="inline text-muted">{r.why}</dd></div>
                      <div><dt className="inline font-medium text-ink">How: </dt><dd className="inline text-muted">{r.how}</dd></div>
                      <div><dt className="inline font-medium text-danger">If ignored: </dt><dd className="inline text-muted">{r.if_ignored}</dd></div>
                    </dl>
                    <div className="mt-2.5 flex items-center gap-2 text-[11px] text-subtle">
                      <ShieldCheck className="h-3.5 w-3.5" /> {r.evidence_strength} evidence
                      {r.estimated_impact && <><ArrowRight className="h-3 w-3" /> {r.estimated_impact}</>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

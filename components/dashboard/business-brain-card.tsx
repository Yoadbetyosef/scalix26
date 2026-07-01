'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Brain, ArrowUpRight, Sparkles } from 'lucide-react'

interface Rec { id: string; title: string; business_confidence: number }
interface BrainState { learnedCount: number; recommendations: Rec[]; dna: { dna_strand: string; strength: number }[] }

const DNA_LABEL: Record<string, string> = { sales: 'Sales', pricing: 'Pricing', communication: 'Communication', customer: 'Customer', operations: 'Operations' }
const confTone = (c: number) => (c >= 65 ? 'bg-emerald-50 text-emerald-700' : c >= 35 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500')

// Compact Business Brain entry point — brand-colored (waveform blue → purple), light. An AI
// COO glance, not analytics. Links to the full page; renders nothing noisy when empty.
export function BusinessBrainCard({ agentId }: { agentId: string }) {
  const [s, setS] = useState<BrainState | null>(null)

  useEffect(() => {
    let on = true
    fetch(`/api/brain/${agentId}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (on && d) setS(d) }).catch(() => {})
    return () => { on = false }
  }, [agentId])

  const href = `/ai-employees/${agentId}/brain`
  const topRec = s?.recommendations?.[0]
  const topDna = (s?.dna || []).filter((d) => d.strength > 0).sort((a, b) => b.strength - a.strength)[0]
  const learned = s?.learnedCount ?? 0

  return (
    <Link href={href} className="block h-full">
      <div className="h-full rounded-2xl border border-hairline bg-gradient-to-br from-[#EEF1FE] to-[#F4EEFB] p-4 shadow-e1 transition-all hover:-translate-y-0.5 hover:shadow-e2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-[#A855F7] text-white shadow-e1"><Brain className="h-[18px] w-[18px]" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Business Brain</p>
            <p className="text-xs text-muted">{learned > 0 ? `Learned ${learned} things about your business.` : 'Ready to study your business.'}</p>
          </div>
          <ArrowUpRight className="h-4 w-4 flex-shrink-0 text-subtle" />
        </div>

        {topRec ? (
          <div className="mt-3 rounded-xl bg-white/70 p-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">Your AI COO recommends</p>
            <div className="mt-0.5 flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{topRec.title}</p>
              <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${confTone(topRec.business_confidence)}`}>{topRec.business_confidence}%</span>
            </div>
            {topDna && <p className="mt-1 text-[10px] text-muted">{DNA_LABEL[topDna.dna_strand]} DNA · {topDna.strength}%</p>}
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/70 p-2.5 text-[11px] text-muted">
            <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-accent-strong" /> Run your first analysis to see what your business is telling you.
          </div>
        )}
      </div>
    </Link>
  )
}

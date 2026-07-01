'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Brain } from 'lucide-react'

interface PulseSource { key: string; label: string; status: string; count: number | null; countLabel: string }
interface Pulse { percent: number; counts: { conversations: number; messages: number; contacts: number }; website: { scanned: boolean; items: number; url: string | null }; sources: PulseSource[]; connectedCount: number }

// The intelligence bar — a READ-ONLY status of how much of the business the AI has learned,
// from REAL data only (website scan + real conversation/channel counts). It is NOT a
// gateway to manual training: the AI learns automatically from connected channels; the
// owner never fills out a training questionnaire.
export function BusinessIntelligenceProgress({ agentId, name }: { agentId: string; name: string }) {
  const [p, setP] = useState<Pulse | null>(null)
  const [fill, setFill] = useState(0)
  const triggered = useRef(false)

  useEffect(() => {
    let on = true
    fetch(`/api/learning/pulse/${agentId}`).then((r) => r.json()).then((d) => {
      if (!on || !d || typeof d.percent !== 'number') return
      setP(d); setTimeout(() => on && setFill(d.percent), 100)
      // Auto-learn: once per mount, if a channel is connected and there are real
      // conversations, kick off learning in the background (server-side throttled).
      // Fire-and-forget — the owner never triggers training manually.
      if (!triggered.current && d.connectedCount > 0 && d.counts.conversations > 0) {
        triggered.current = true
        fetch(`/api/learning/auto/${agentId}`, { method: 'POST' }).catch(() => {})
      }
    }).catch(() => {})
    return () => { on = false }
  }, [agentId])

  const learning = !!p && p.sources.some((s) => s.status === 'learning' || s.status === 'complete')
  const summary = p ? realSummary(p) : ''

  return (
    <div className="block rounded-2xl bg-white p-4 shadow-e1 ring-1 ring-hairline">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><Brain className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink">{name}’s business memory</span>
            {p && <span className="ml-auto text-xs tabular-nums text-subtle">{p.percent}%</span>}
          </div>
          <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
            <div className="relative h-full rounded-full bg-gradient-to-r from-accent via-[#7E9DEF] to-[#A855F7] transition-[width] duration-[1200ms] ease-out" style={{ width: `${Math.max(3, fill)}%` }}>
              {learning && <span className="bip-shimmer absolute inset-0" />}
            </div>
          </div>
          <p className={cn('mt-1.5 truncate text-xs', p ? 'text-muted' : 'text-muted')}>{p ? summary : 'Reading your business…'}</p>
        </div>
      </div>
    </div>
  )
}

function realSummary(p: Pulse): string {
  const parts: string[] = []
  if (p.website.scanned) parts.push(`Website · ${p.website.items} items`)
  for (const s of p.sources) if (s.status !== 'not_connected' && s.countLabel && s.key !== 'website') parts.push(s.countLabel)
  if (!parts.length) return 'Connect email, phone and social — the AI learns from your real conversations automatically.'
  return parts.slice(0, 3).join('  ·  ')
}

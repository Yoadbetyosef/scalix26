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
    <div className="v2 v2-embedded">
      {/* The memory bar. Not a card: this is a status line about the employee below it, and boxing it
          made it read as the first of fourteen sections rather than as the page's own preamble. The
          fill is the same gradient rule the tabs and the sync progress use. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="v2-chip-sq" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><Brain /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <p className="v2-kick" style={{ marginBottom: 0, ['--ghue' as string]: 'var(--v2-t3)' }}><i />{name}’s business memory</p>
            <s style={{ flex: 1 }} />
            {p && <span className="v2-kick" style={{ marginBottom: 0, fontVariantNumeric: 'tabular-nums' }}>{p.percent}%</span>}
          </div>
          <div style={{ position: 'relative', marginTop: 8, height: 2, borderRadius: 2, background: 'var(--v2-line)', overflow: 'hidden' }}>
            <div
              className="relative h-full"
              style={{
                borderRadius: 2,
                background: 'linear-gradient(90deg, var(--v2-t1), var(--v2-t3) 60%, var(--v2-t4))',
                width: `${Math.max(3, fill)}%`,
                transition: 'width 1200ms ease-out',
              }}
            >
              {/* The shimmer is an OVERLAY, never the fill itself: .bip-shimmer sets its own
                  background and animates translateX(-100% → 220%), so putting it on the bar
                  replaced the gradient and slid the whole bar off to the right. */}
              {learning && <span className="bip-shimmer absolute inset-0" style={{ borderRadius: 2 }} />}
            </div>
          </div>
          <p className="v2-fhint" style={{ marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p ? summary : 'Reading your business…'}
          </p>
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

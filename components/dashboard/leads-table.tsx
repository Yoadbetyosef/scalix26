'use client'

import { useState } from 'react'
import { TrendingUp, Phone, Check, X, RotateCcw, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { EmptyState } from '@/components/ui/empty-state'
import type { Lead, LeadSource, LeadStatus } from '@/types'

const SOURCE_LABELS: Record<LeadSource, string> = {
  missed_call: 'Missed Call',
  voice_call: 'Voice Call',
  web_form: 'Web Form',
  google_lsa: 'Google LSA',
  facebook: 'Facebook',
  yelp: 'Yelp',
  angi: 'Angi',
  other: 'Other',
}

// Status → color, where color communicates state (not decoration): a hot New lead
// carries a soft tint + accent bar; everything else stays calm white with a quiet
// status dot. No emoji — a colored dot reads premium and consistent.
const STATUS_CONFIG: Record<LeadStatus, { label: string; dot: string; card: string; border: string; badge: string }> = {
  new:       { label: 'New',       dot: 'bg-amber-400',   card: 'bg-amber-50/50', border: 'border-l-amber-400',         badge: 'bg-amber-100 text-amber-700' },
  contacted: { label: 'Open',      dot: 'bg-blue-400',    card: 'bg-white',       border: 'border-l-blue-400',          badge: 'bg-blue-50 text-blue-700' },
  booked:    { label: 'Booked',    dot: 'bg-emerald-500', card: 'bg-white',       border: 'border-l-emerald-500',       badge: 'bg-emerald-50 text-emerald-700' },
  dismissed: { label: 'Dismissed', dot: 'bg-muted',       card: 'bg-white',       border: 'border-l-hairline-strong',   badge: 'bg-sunken text-muted' },
}

function relativeTime(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return 'Just now'
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`
  return `${Math.floor(sec / 86400)} d ago`
}

function StatPill({ dot, n, label }: { dot: string; n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="sx-tabular font-medium text-ink">{n}</span>
      <span className="text-subtle">{label}</span>
    </span>
  )
}

export function LeadsTable({ leads, links }: { leads: Lead[]; links: Record<string, string> }) {
  const router = useRouter()
  const [rows, setRows] = useState<Lead[]>(leads)
  const [updating, setUpdating] = useState<string | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)

  async function updateStatus(e: React.MouseEvent, id: string, status: LeadStatus) {
    e.stopPropagation()
    setUpdating(id)
    const supabase = createClient()
    const { error } = await supabase.from('leads').update({ status }).eq('id', id)
    if (!error) {
      // A won or dismissed lead shouldn't keep getting drip follow-ups.
      if (status === 'booked' || status === 'dismissed') {
        await supabase.from('drip_campaigns').update({ status: 'stopped' }).eq('lead_id', id).eq('status', 'active')
      }
      setRows((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)))
      router.refresh()
    }
    setUpdating(null)
  }

  const counts = {
    new: rows.filter((l) => l.status === 'new').length,
    contacted: rows.filter((l) => l.status === 'contacted').length,
    booked: rows.filter((l) => l.status === 'booked').length,
  }
  const dismissedCount = rows.filter((l) => l.status === 'dismissed').length
  const visibleRows = showDismissed ? rows : rows.filter((l) => l.status !== 'dismissed')

  if (!rows.length) {
    return (
      <EmptyState icon={ShieldCheck} title="You&rsquo;re protected">
        The next missed opportunity shows up here the instant it happens — captured by your AI before it becomes a lost customer.
      </EmptyState>
    )
  }

  // L1 — no active leads (dismissed ones may still exist). Mirror the Appointments-tab
  // empty state: icon tile + title + one-line body. The "Show dismissed (N)" control
  // stays, rendered as a text button below.
  if (!visibleRows.length) {
    return (
      <div>
        <EmptyState icon={TrendingUp} title="No leads yet">
          When Rudi captures a lead from a call or message, it lands here automatically.
        </EmptyState>
        {dismissedCount > 0 && (
          <div className="flex justify-center -mt-8 pb-2">
            <button
              onClick={() => setShowDismissed((s) => !s)}
              className="text-xs font-medium text-muted hover:text-ink px-1"
            >
              {showDismissed ? 'Hide dismissed' : `Show dismissed (${dismissedCount})`}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Summary header — quiet, tabular, colored dots instead of emoji */}
      <div className="flex flex-wrap items-center gap-x-7 gap-y-2 sx-card px-5 py-3.5 text-sm">
        <StatPill dot="bg-amber-400" n={counts.new} label="New" />
        <StatPill dot="bg-blue-400" n={counts.contacted} label="Open" />
        <StatPill dot="bg-emerald-500" n={counts.booked} label="Booked" />
      </div>

      {/* Lead cards */}
      <div className="space-y-2.5 sx-stagger">
        {visibleRows.map((lead) => {
          const cfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG.contacted
          const href = links[lead.id]
          const isDismissed = lead.status === 'dismissed'
          return (
            <div
              key={lead.id}
              onClick={href ? () => router.push(href) : undefined}
              className={`rounded-2xl border border-hairline border-l-[3px] shadow-e1 p-4 sm:p-5 transition-all ${cfg.card} ${cfg.border} ${isDismissed ? 'opacity-60' : ''} ${href ? 'cursor-pointer hover:shadow-e2 hover:-translate-y-0.5' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-ink truncate">{lead.name || 'Unknown'}</span>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.badge}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} /> {cfg.label}
                    </span>
                  </div>
                  <p className="text-sm text-subtle mt-1 break-all">{lead.phone}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {SOURCE_LABELS[lead.source] || lead.source} • {relativeTime(lead.created_at)}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex flex-col items-stretch gap-2 flex-shrink-0">
                  {lead.phone && (
                    <a
                      href={`tel:${lead.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="tap-target inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-ink text-white shadow-e1 transition-all hover:bg-ink/90 hover:shadow-e2"
                    >
                      <Phone className="w-3.5 h-3.5" /> Call Now
                    </a>
                  )}
                  {lead.status !== 'booked' && !isDismissed && (
                    <button
                      onClick={(e) => updateStatus(e, lead.id, 'booked')}
                      disabled={updating === lead.id}
                      className="tap-target inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-white border border-hairline-strong text-ink shadow-e1 hover:bg-sunken hover:shadow-e2 transition-all disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2.5} /> {updating === lead.id ? '…' : 'Mark as Booked'}
                    </button>
                  )}
                  {!isDismissed && (
                    <button
                      onClick={(e) => updateStatus(e, lead.id, 'dismissed')}
                      disabled={updating === lead.id}
                      className="tap-target inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium text-muted hover:text-ink hover:bg-sunken disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" /> Dismiss
                    </button>
                  )}
                  {isDismissed && (
                    <button
                      onClick={(e) => updateStatus(e, lead.id, 'contacted')}
                      disabled={updating === lead.id}
                      className="tap-target inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-sunken text-subtle hover:bg-hairline-strong disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> {updating === lead.id ? '…' : 'Restore'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Show / hide dismissed */}
      {dismissedCount > 0 && (
        <button
          onClick={() => setShowDismissed((s) => !s)}
          className="text-xs font-medium text-muted hover:text-ink px-1"
        >
          {showDismissed ? 'Hide dismissed' : `Show dismissed (${dismissedCount})`}
        </button>
      )}
    </div>
  )
}

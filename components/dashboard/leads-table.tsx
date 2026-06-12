'use client'

import { useState } from 'react'
import { TrendingUp, Phone, Check, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
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

const STATUS_CONFIG: Record<LeadStatus, { label: string; emoji: string; card: string; border: string; badge: string }> = {
  new:       { label: 'New',       emoji: '🔥', card: 'bg-orange-50',  border: 'border-l-orange-400', badge: 'bg-orange-100 text-orange-700' },
  contacted: { label: 'Open',      emoji: '🔔', card: 'bg-white',      border: 'border-l-blue-400',   badge: 'bg-blue-50 text-blue-700' },
  booked:    { label: 'Booked',    emoji: '✅', card: 'bg-green-50',   border: 'border-l-green-500',  badge: 'bg-green-100 text-green-700' },
  dismissed: { label: 'Dismissed', emoji: '🚫', card: 'bg-gray-50',    border: 'border-l-gray-300',   badge: 'bg-gray-100 text-gray-500' },
}

function relativeTime(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return 'Just now'
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`
  return `${Math.floor(sec / 86400)} d ago`
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
      <div className="flex flex-col items-center justify-center h-64 text-gray-400 bg-white rounded-xl border border-gray-100 shadow-sm">
        <TrendingUp className="w-12 h-12 mb-3" />
        <p className="text-sm">No leads yet</p>
        <p className="text-xs text-gray-400 mt-1 text-center px-4">Leads appear here automatically when a customer reaches out from any source</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Summary header */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 text-sm font-medium">
        <span className="text-orange-600">🔥 {counts.new} New</span>
        <span className="text-blue-600">🔔 {counts.contacted} Open</span>
        <span className="text-green-600">✅ {counts.booked} Booked</span>
      </div>

      {/* Lead cards */}
      <div className="space-y-2">
        {visibleRows.map((lead) => {
          const cfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG.contacted
          const href = links[lead.id]
          const isDismissed = lead.status === 'dismissed'
          return (
            <div
              key={lead.id}
              onClick={href ? () => router.push(href) : undefined}
              className={`rounded-xl border border-gray-100 border-l-4 shadow-sm p-4 transition-colors ${cfg.card} ${cfg.border} ${isDismissed ? 'opacity-60' : ''} ${href ? 'cursor-pointer hover:brightness-[0.98]' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 truncate">{lead.name || 'Unknown'}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.badge}`}>
                      {cfg.emoji} {cfg.label}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1 break-all">{lead.phone}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {SOURCE_LABELS[lead.source] || lead.source} • {relativeTime(lead.created_at)}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex flex-col items-stretch gap-2 flex-shrink-0">
                  {lead.phone && (
                    <a
                      href={`tel:${lead.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="tap-target inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#4ecdc4] text-white hover:bg-[#3db8af]"
                    >
                      <Phone className="w-3.5 h-3.5" /> Call Now
                    </a>
                  )}
                  {lead.status !== 'booked' && !isDismissed && (
                    <button
                      onClick={(e) => updateStatus(e, lead.id, 'booked')}
                      disabled={updating === lead.id}
                      className="tap-target inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" /> {updating === lead.id ? '…' : 'Mark as Booked'}
                    </button>
                  )}
                  {!isDismissed && (
                    <button
                      onClick={(e) => updateStatus(e, lead.id, 'dismissed')}
                      disabled={updating === lead.id}
                      className="tap-target inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" /> Dismiss
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
          className="text-xs font-medium text-gray-400 hover:text-gray-600 px-1"
        >
          {showDismissed ? 'Hide dismissed' : `Show dismissed (${dismissedCount})`}
        </button>
      )}
    </div>
  )
}

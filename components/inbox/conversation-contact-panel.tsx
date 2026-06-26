'use client'

import { useState } from 'react'
import { Info, X, Phone, MessageSquare, MessageCircle, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { contactIdentifier } from '@/lib/utils'
import Link from 'next/link'
import type { CustomerProfile } from '@/lib/customer/profile'

interface ContactInfo {
  id?: string
  name?: string
  phone?: string
  email?: string
  channel: string
  sentiment?: string
  messageCount: number
}

// ─── Customer Intelligence Card helpers ─────────────────────────────────────
// All deterministic, fact-only (no AI, no invented data). Pure functions of the
// Sprint-001 profile data, so the component stays presentational.

const LEAD_OPEN = new Set(['new', 'contacted', 'called_back'])
const LEAD_LABELS: Record<string, string> = {
  new: 'New lead', contacted: 'Contacted', booked: 'Booked', called_back: 'Called back', dismissed: 'Dismissed',
}

function truncate(value: string, max: number): string {
  const t = value.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

function tms(iso: string | null): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return isNaN(t) ? 0 : t
}

function isDefaultLanguage(lang: string | null): boolean {
  if (!lang) return true
  return ['en', 'eng', 'english'].includes(lang.trim().toLowerCase())
}

function typePillClass(type: CustomerProfile['customerType']): string {
  switch (type) {
    case 'active':
    case 'returning': return 'bg-[#4ecdc4]/15 text-[#3db8af]'
    case 'new': return 'bg-blue-50 text-blue-600'
    case 'dormant': return 'bg-amber-50 text-amber-700'
    default: return 'bg-gray-100 text-gray-600'
  }
}

// "What happened last time?" — one factual sentence.
function buildPrimaryInsight(p: CustomerProfile): string | null {
  const appt = p.recentAppointments[0]
  if (appt) {
    const svc = appt.serviceType || 'an appointment'
    if (appt.status === 'completed') return `Last completed ${svc}${appt.dateLabel ? ` on ${appt.dateLabel}` : ''}.`
    if (appt.status === 'cancelled') return `A previous ${svc} was cancelled.`
    return `Upcoming ${svc}${appt.dateLabel ? ` on ${appt.dateLabel}` : ''} (confirmed).`
  }
  if (p.leadStatus && LEAD_OPEN.has(p.leadStatus)) {
    return `Reached out previously but hasn’t booked yet.`
  }
  const s = p.recentSummaries[0]
  if (s?.summary) return truncate(s.summary, 140)
  return null
}

// "What should happen next?" — deterministic recommendation, never an AI guess.
function buildNextStep(p: CustomerProfile): string | null {
  const appt = p.recentAppointments[0]
  if (appt?.status === 'cancelled') return 'Ask if they’d like to reschedule.'
  if (appt && appt.status !== 'completed' && appt.status !== 'cancelled') {
    return 'No action needed — appointment is on the calendar.'
  }
  if (p.leadStatus && LEAD_OPEN.has(p.leadStatus)) return 'Ask if they still want help with their previous request.'
  if (p.customerType === 'dormant') return 'Re-engage — it’s been a while since their last visit.'
  if (appt?.status === 'completed') return 'Offer a follow-up or the next service.'
  return 'No action needed yet.'
}

interface TimelineItem { key: string; kind: 'appointment' | 'conversation'; label: string; dateLabel: string; at: number }

// "Timeline preview" — most recent 3 dated events across appointments + conversations.
function buildTimeline(p: CustomerProfile): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const a of p.recentAppointments) {
    items.push({
      key: `a-${a.id}`, kind: 'appointment',
      label: `${a.serviceType || 'Appointment'}${a.status ? ` · ${a.status}` : ''}`,
      dateLabel: a.dateLabel, at: tms(a.at),
    })
  }
  for (const s of p.recentSummaries) {
    items.push({ key: `c-${s.id}`, kind: 'conversation', label: truncate(s.summary, 90), dateLabel: s.dateLabel, at: tms(s.at) })
  }
  return items.sort((x, y) => y.at - x.at).slice(0, 3)
}

// Read-only Customer Intelligence Card. Renders nothing when the profile is empty,
// so panels for new/unknown contacts look exactly as before. Owner-friendly, answers
// who / what happened / what to know / what next in ~5 seconds. Reused desktop + mobile.
export function CustomerProfileBlock({
  profile,
  className,
}: {
  profile?: CustomerProfile | null
  className?: string
}) {
  if (!profile || profile.isEmpty) return null

  const insight = buildPrimaryInsight(profile)
  const nextStep = buildNextStep(profile)
  const timeline = buildTimeline(profile)
  const leadLabel = profile.leadStatus ? (LEAD_LABELS[profile.leadStatus] || profile.leadStatus) : null
  const showLanguage = !isDefaultLanguage(profile.language)
  const hasContext = !!profile.lastInteractionLabel || !!leadLabel || showLanguage

  return (
    <div className={`border-t border-gray-100 ${className || ''}`}>
      {/* Header — customer type badge (business-friendly, no confidence noise) */}
      <div className="flex items-center gap-2 mb-2.5">
        {profile.customerTypeLabel ? (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${typePillClass(profile.customerType)}`}>
            {profile.customerTypeLabel}
          </span>
        ) : (
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</h3>
        )}
      </div>

      {/* Primary insight — what happened last time */}
      {insight && <p className="text-sm text-gray-800 leading-snug mb-3">{insight}</p>}

      {/* Important context — only non-empty rows */}
      {hasContext && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs">
          {profile.lastInteractionLabel && (
            <span><span className="text-gray-400">Last seen </span><span className="font-medium text-gray-700">{profile.lastInteractionLabel}</span></span>
          )}
          {leadLabel && (
            <span><span className="text-gray-400">Lead </span><span className="font-medium text-gray-700">{leadLabel}</span></span>
          )}
          {showLanguage && (
            <span><span className="text-gray-400">Language </span><span className="font-medium text-gray-700">{profile.language}</span></span>
          )}
        </div>
      )}

      {/* Recommended next step — deterministic */}
      {nextStep && (
        <div className="mb-3 rounded-lg bg-[#4ecdc4]/[0.07] border border-[#4ecdc4]/20 px-3 py-2">
          <p className="text-[10px] font-semibold text-[#3db8af] uppercase tracking-wide mb-0.5">Recommended next step</p>
          <p className="text-sm text-gray-800 leading-snug">{nextStep}</p>
        </div>
      )}

      {/* Timeline preview — last 2–3 events */}
      {timeline.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Recent activity</p>
          <ul className="space-y-2">
            {timeline.map((t) => (
              <li key={t.key} className="flex items-start gap-2 text-xs">
                <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.kind === 'appointment' ? 'bg-[#4ecdc4]' : 'bg-gray-300'}`} />
                <span className="flex-1 min-w-0 text-gray-600">{t.label}</span>
                {t.dateLabel && <span className="text-gray-400 flex-shrink-0">{t.dateLabel}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function ConversationContactPanel({ contact, profile }: { contact: ContactInfo; profile?: CustomerProfile | null }) {
  const [open, setOpen] = useState(false)

  const ident = contactIdentifier(contact.channel, contact.phone)
  const IdentIcon = ident && !ident.isPhone ? MessageCircle : Phone

  return (
    <>
      {/* Trigger — mobile only */}
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden w-11 h-11 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
        aria-label="Contact info"
      >
        <Info className="w-4 h-4" />
      </button>

      {/* Slide-up drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl max-h-[70vh] overflow-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <span className="font-semibold text-gray-900">Contact Info</span>
              <button
                onClick={() => setOpen(false)}
                className="w-11 h-11 -m-1.5 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {contact.name && (
                <div className="flex items-center gap-3 text-sm">
                  <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700">{contact.name}</span>
                </div>
              )}
              {ident && (
                <div className="flex items-start gap-3 text-sm">
                  <IdentIcon className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    {ident.isPhone ? (
                      <a href={`tel:${ident.value}`} className="text-[#4ecdc4] break-all">{ident.value}</a>
                    ) : (
                      <span className="text-gray-700 break-all">{ident.value}</span>
                    )}
                    <p className="text-xs text-gray-400">{ident.label}</p>
                  </div>
                </div>
              )}
              {contact.email && (
                <div className="flex items-center gap-3 text-sm">
                  <MessageSquare className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700 break-all">{contact.email}</span>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Details</h3>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Channel</span>
                <Badge variant={contact.channel as 'sms' | 'voice' | 'whatsapp' | 'instagram' | 'facebook'}>
                  {contact.channel}
                </Badge>
              </div>
              {contact.sentiment && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">Sentiment</span>
                  <Badge variant={contact.sentiment as 'positive' | 'neutral' | 'negative'}>{contact.sentiment}</Badge>
                </div>
              )}
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Messages</span>
                <span className="font-medium text-gray-700">{contact.messageCount}</span>
              </div>
            </div>

            <CustomerProfileBlock profile={profile} className="px-5 py-4" />

            {contact.id && (
              <div className="px-5 pb-8">
                <Link
                  href={`/contacts/${contact.id}`}
                  className="block text-center text-sm text-[#4ecdc4] font-medium py-3 border border-[#4ecdc4]/30 rounded-xl hover:bg-[#4ecdc4]/5"
                  onClick={() => setOpen(false)}
                >
                  View Full Profile →
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

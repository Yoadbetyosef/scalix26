'use client'

import { useState } from 'react'
import { Info, X, Phone, MessageSquare, MessageCircle, User, Building2 } from 'lucide-react'
import { contactIdentifier } from '@/lib/utils'
import { channelHue } from '@/app/(v2)/v2/channels'
import Link from 'next/link'
import type { CustomerProfile } from '@/lib/customer/profile'
import { ConversationActions } from '@/components/inbox/conversation-actions'

interface ContactInfo {
  id?: string
  name?: string
  companyName?: string
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

// The customer-type pill is .v2-stat in a hue — one chip component, four values of one variable,
// rather than four hand-mixed tint/ink pairs that have to be kept legible independently.
function typeHue(type: CustomerProfile['customerType']): string {
  switch (type) {
    case 'active':
    case 'returning': return 'var(--v2-t2)'
    case 'new': return 'var(--v2-t1)'
    case 'dormant': return 'var(--v2-t4)'
    default: return 'var(--v2-ink-45)'
  }
}

// Channel and sentiment wear the same chip. The channel hue comes from the shared, directive-free
// table so a conversation keeps its colour from the row you clicked to the panel you opened — and so
// a Server Component can read it, which it cannot do from this file (see channels.ts).
const SENTIMENT_HUE: Record<string, string> = {
  positive: 'var(--v2-t2)', neutral: 'var(--v2-mute)', negative: 'var(--v2-t4)',
}
export function Chip({ value, hue }: { value: string; hue: string }) {
  return <span className="v2-stat" style={{ ['--chan' as string]: hue }}>{value}</span>
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
    <div className={className || ''}>
      {/* Header — customer type badge (business-friendly, no confidence noise) */}
      <div className="flex items-center gap-2 mb-2.5">
        {profile.customerTypeLabel
          ? <Chip value={profile.customerTypeLabel} hue={typeHue(profile.customerType)} />
          : <p className="v2-kick">Customer</p>}
      </div>

      {/* Primary insight — what happened last time */}
      {insight && <p className="text-sm leading-snug mb-3" style={{ color: 'var(--v2-ink)' }}>{insight}</p>}

      {/* Important context — only non-empty rows */}
      {hasContext && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs">
          {profile.lastInteractionLabel && (
            <span><span className="text-muted">Last seen </span><span className="font-medium text-ink">{profile.lastInteractionLabel}</span></span>
          )}
          {leadLabel && (
            <span><span className="text-muted">Lead </span><span className="font-medium text-ink">{leadLabel}</span></span>
          )}
          {showLanguage && (
            <span><span className="text-muted">Language </span><span className="font-medium text-ink">{profile.language}</span></span>
          )}
        </div>
      )}

      {/* Recommended next step — deterministic */}
      {nextStep && (
        <div className="v2-card mb-3" style={{ gap: 4, padding: '11px 13px' }}>
          <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />Recommended next step</p>
          <p className="text-sm leading-snug" style={{ color: 'var(--v2-ink)' }}>{nextStep}</p>
        </div>
      )}

      {/* Timeline preview — last 2–3 events */}
      {timeline.length > 0 && (
        <div>
          <p className="v2-kick mb-1.5">Recent activity</p>
          <ul className="space-y-2">
            {timeline.map((t) => (
              <li key={t.key} className="flex items-start gap-2 text-xs">
                <span className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: t.kind === 'appointment' ? 'var(--v2-t1)' : 'var(--v2-line)' }} />
                <span className="flex-1 min-w-0 text-subtle">{t.label}</span>
                {t.dateLabel && <span className="text-muted flex-shrink-0">{t.dateLabel}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function ConversationContactPanel({ contact, profile, conversationId, currentStatus }: { contact: ContactInfo; profile?: CustomerProfile | null; conversationId?: string; currentStatus?: string }) {
  const [open, setOpen] = useState(false)

  const ident = contactIdentifier(contact.channel, contact.phone)
  const IdentIcon = ident && !ident.isPhone ? MessageCircle : Phone

  return (
    <>
      {/* Trigger — mobile only */}
      <button
        onClick={() => setOpen(true)}
        className="v2-ico lg:hidden"
        aria-label="Contact info"
      >
        <Info className="w-4 h-4" />
      </button>

      {/* Slide-up drawer */}
      {open && (
        <div className="v2 lg:hidden fixed inset-0 z-50">
          <div className="v2-veil" onClick={() => setOpen(false)} />
          <div className="v2-drawer">
            <section className="flex items-center justify-between" style={{ paddingTop: 14, paddingBottom: 14 }}>
              <p className="v2-kick">Contact</p>
              <button onClick={() => setOpen(false)} className="v2-ico" aria-label="Close">
                <X />
              </button>
            </section>

            <section className="space-y-3">
              {/* The company sits above the person's name, in the same fact list. On this panel
                  there is room for both lines, so it is not composed with a dash the way a one-line
                  row has to be. */}
              {contact.companyName && (
                <div className="flex items-center gap-3 text-sm">
                  <Building2 className="w-4 h-4 text-muted flex-shrink-0" />
                  <span className="text-ink font-medium">{contact.companyName}</span>
                </div>
              )}
              {contact.name && (
                <div className="flex items-center gap-3 text-sm">
                  <User className="w-4 h-4 text-muted flex-shrink-0" />
                  <span className="text-ink">{contact.name}</span>
                </div>
              )}
              {ident && (
                <div className="flex items-start gap-3 text-sm">
                  <IdentIcon className="w-4 h-4 text-muted flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    {ident.isPhone ? (
                      <a href={`tel:${ident.value}`} className="text-ink font-medium hover:underline break-all">{ident.value}</a>
                    ) : (
                      <span className="text-ink break-all">{ident.value}</span>
                    )}
                    <p className="text-xs text-muted">{ident.label}</p>
                  </div>
                </div>
              )}
              {contact.email && (
                <div className="flex items-center gap-3 text-sm">
                  <MessageSquare className="w-4 h-4 text-muted flex-shrink-0" />
                  <span className="text-ink break-all">{contact.email}</span>
                </div>
              )}
            </section>

            <section>
              <p className="v2-kick" style={{ marginBottom: 10 }}>Details</p>
              <dl className="v2-facts">
                <div>
                  <dt>Channel</dt>
                  <dd><Chip value={contact.channel} hue={channelHue(contact.channel)} /></dd>
                </div>
                {contact.sentiment && (
                  <div>
                    <dt>Sentiment</dt>
                    <dd><Chip value={contact.sentiment} hue={SENTIMENT_HUE[contact.sentiment] ?? 'var(--v2-ink-45)'} /></dd>
                  </div>
                )}
                <div><dt>Messages</dt><dd>{contact.messageCount}</dd></div>
              </dl>
            </section>

            <section><CustomerProfileBlock profile={profile} /></section>

            {/* Status actions — mobile only. Close moves here from the top bar (C1),
                using the SAME ConversationActions handler. md:hidden keeps desktop untouched. */}
            {conversationId && currentStatus && (
              <section className="md:hidden">
                <ConversationActions
                  conversationId={conversationId}
                  currentStatus={currentStatus}
                  place="menu"
                  onAction={() => setOpen(false)}
                />
              </section>
            )}

            {contact.id && (
              <section>
                <Link href={`/contacts/${contact.id}`} className="v2-act" data-wide onClick={() => setOpen(false)}>
                  View full profile →
                </Link>
              </section>
            )}
          </div>
        </div>
      )}
    </>
  )
}

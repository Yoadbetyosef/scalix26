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

// Read-only Customer Profile V1 block. Renders nothing when the profile is empty,
// so panels for new/unknown contacts look exactly as they did before this feature.
// Shows only existing facts (no AI guesses, no memory). Reused on desktop + mobile.
export function CustomerProfileBlock({
  profile,
  className,
}: {
  profile?: CustomerProfile | null
  className?: string
}) {
  if (!profile || profile.isEmpty) return null

  const hasFacts =
    !!profile.stageLabel ||
    profile.totalConversations != null ||
    !!profile.lastInteractionLabel ||
    !!profile.leadStatus ||
    !!profile.language

  return (
    <div className={`border-t border-gray-100 ${className || ''}`}>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Customer Profile</h3>

      <div className="space-y-3">
        {hasFacts && (
          <div className="space-y-2 text-xs">
            {profile.stageLabel && (
              <div className="flex justify-between"><span className="text-gray-500">Stage</span><span className="font-medium text-gray-700">{profile.stageLabel}</span></div>
            )}
            {profile.totalConversations != null && (
              <div className="flex justify-between"><span className="text-gray-500">Conversations</span><span className="font-medium text-gray-700">{profile.totalConversations}</span></div>
            )}
            {profile.lastInteractionLabel && (
              <div className="flex justify-between"><span className="text-gray-500">Last seen</span><span className="font-medium text-gray-700">{profile.lastInteractionLabel}</span></div>
            )}
            {profile.leadStatus && (
              <div className="flex justify-between"><span className="text-gray-500">Lead</span><span className="font-medium text-gray-700 capitalize">{profile.leadStatus}</span></div>
            )}
            {profile.language && (
              <div className="flex justify-between"><span className="text-gray-500">Language</span><span className="font-medium text-gray-700">{profile.language}</span></div>
            )}
          </div>
        )}

        {profile.recentAppointments.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-1">Recent appointments</p>
            <ul className="space-y-1">
              {profile.recentAppointments.map((a) => (
                <li key={a.id} className="text-xs text-gray-600 flex justify-between gap-2">
                  <span className="truncate">{a.serviceType || 'Appointment'}{a.status ? ` · ${a.status}` : ''}</span>
                  {a.dateLabel && <span className="text-gray-400 flex-shrink-0">{a.dateLabel}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {profile.recentSummaries.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-1">Recent conversations</p>
            <ul className="space-y-2">
              {profile.recentSummaries.map((s) => (
                <li key={s.id} className="text-xs text-gray-600">
                  <span className="text-gray-400">{[s.dateLabel, s.channel].filter(Boolean).join(' · ')}</span>
                  <p className="text-gray-600">{s.summary}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {profile.notes && (
          <div>
            <p className="text-xs text-gray-400 mb-1">Notes</p>
            <p className="text-xs text-gray-600 whitespace-pre-wrap">{profile.notes}</p>
          </div>
        )}
      </div>
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

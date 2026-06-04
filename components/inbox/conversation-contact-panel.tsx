'use client'

import { useState } from 'react'
import { Info, X, Phone, MessageSquare, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

interface ContactInfo {
  id?: string
  name?: string
  phone?: string
  email?: string
  channel: string
  sentiment?: string
  messageCount: number
}

export function ConversationContactPanel({ contact }: { contact: ContactInfo }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Trigger — mobile only */}
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
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
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"
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
              {contact.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <a href={`tel:${contact.phone}`} className="text-[#4ecdc4]">{contact.phone}</a>
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

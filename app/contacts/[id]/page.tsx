import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Phone, Mail, MapPin, MessageCircle, Globe, Calendar, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatDateTime, contactIdentifier } from '@/lib/utils'

export default async function ContactProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams
  const backHref = from === 'leads' ? '/dashboard?tab=leads' : '/contacts'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const service = await createServiceClient()
  const { data: tenant } = await service.from('tenants').select('id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant) redirect('/auth/signup')

  const { id } = await params

  const { data: contact } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!contact) notFound()

  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, channel, status, summary, created_at, updated_at')
    .eq('contact_id', id)
    .eq('tenant_id', tenant.id)
    .order('updated_at', { ascending: false })
    .limit(50)

  const ident = contactIdentifier(contact.channel, contact.phone)
  const IdentIcon = ident?.isPhone ? Phone : MessageCircle

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Link href={backHref} className="tap-target -ml-2 flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 flex-shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="w-12 h-12 rounded-full bg-[#4ecdc4]/10 flex items-center justify-center text-[#4ecdc4] text-lg font-semibold flex-shrink-0">
          {contact.name?.[0] || contact.phone?.[0] || '?'}
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{contact.name || 'Unknown contact'}</h1>
          {contact.channel && (
            <Badge variant={contact.channel as 'sms' | 'voice' | 'whatsapp' | 'instagram' | 'facebook'} className="mt-0.5">
              {contact.channel}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contact details */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Contact Details</h2>
            <div className="space-y-3 text-sm">
              {ident && (
                <div className="flex items-start gap-3">
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
                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700 break-all">{contact.email}</span>
                </div>
              )}
              {contact.address && (
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700">{contact.address}</span>
                </div>
              )}
              {contact.language && (
                <div className="flex items-start gap-3">
                  <Globe className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700 uppercase">{contact.language}</span>
                </div>
              )}
              <div className="flex items-start gap-3">
                <MessageCircle className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                <span className="text-gray-700">{contact.total_conversations} conversation{contact.total_conversations !== 1 ? 's' : ''}</span>
              </div>
              {contact.last_interaction && (
                <div className="flex items-start gap-3">
                  <Clock className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700">Last contact {formatDate(contact.last_interaction)}</span>
                </div>
              )}
              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                <span className="text-gray-700">Added {formatDate(contact.created_at)}</span>
              </div>
            </div>
          </div>

          {contact.notes && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</h2>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{contact.notes}</p>
            </div>
          )}
        </div>

        {/* Conversation history */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Conversation History</h2>
            </div>
            {!conversations?.length ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">No conversations yet</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {conversations.map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/inbox/${conv.id}`}
                    className="tap-target block px-5 py-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge variant={conv.channel as 'sms' | 'voice' | 'whatsapp' | 'instagram' | 'facebook'}>{conv.channel}</Badge>
                      <Badge variant={conv.status as 'open' | 'resolved' | 'closed'}>{conv.status}</Badge>
                      <span className="text-xs text-gray-400 ml-auto flex-shrink-0">{formatDateTime(conv.updated_at)}</span>
                    </div>
                    <p className="text-sm text-gray-600 line-clamp-2">
                      {conv.summary || 'No summary available'}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

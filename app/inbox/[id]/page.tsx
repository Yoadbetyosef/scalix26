import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Phone, MessageSquare, MessageCircle, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, formatDate, contactIdentifier } from '@/lib/utils'
import { ConversationActions } from '@/components/inbox/conversation-actions'
import { ConversationContactPanel } from '@/components/inbox/conversation-contact-panel'
import { HumanTakeover } from '@/components/inbox/human-takeover'
import { MessageComposer } from '@/components/inbox/message-composer'

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant) redirect('/auth/signup')

  const { id } = await params

  const { data: conv } = await supabase
    .from('conversations')
    .select('*, contact:contacts(*), ai_employee:ai_employees(name)')
    .eq('id', id)
    .eq('tenant_id', tenant.id)
    .single()

  if (!conv) notFound()

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', id)
    .order('timestamp', { ascending: true })

  const contact = conv.contact as { id: string; name?: string; phone?: string; email?: string; address?: string } | null

  const contactInfo = {
    id: contact?.id,
    name: contact?.name,
    phone: contact?.phone,
    email: contact?.email,
    channel: conv.channel,
    sentiment: conv.sentiment,
    messageCount: messages?.length || 0,
  }

  const ident = contactIdentifier(conv.channel, contact?.phone)
  const IdentIcon = ident && !ident.isPhone ? MessageCircle : Phone

  return (
    <div className="flex flex-col h-screen max-h-screen">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 sm:py-4 bg-white border-b border-gray-100 flex-shrink-0">
        <Link href="/inbox" className="tap-target -ml-2 flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 flex-shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-medium flex-shrink-0">
          {contact?.name?.[0] || contact?.phone?.[0] || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 truncate">
            {contact?.name || contact?.phone || 'Unknown'}
          </h2>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 flex-wrap">
            <span>{conv.channel}</span>
            <span>·</span>
            <span>{formatDate(conv.created_at)}</span>
            {conv.ai_employee && <><span>·</span><span className="truncate">{(conv.ai_employee as { name: string }).name}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
          <Badge variant={conv.status as 'open' | 'resolved' | 'closed'}>{conv.status}</Badge>
          <HumanTakeover conversationId={id} active={conv.human_takeover === true} />
          <ConversationActions conversationId={id} currentStatus={conv.status} />
          {/* Mobile contact info trigger */}
          <ConversationContactPanel contact={contactInfo} />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Messages */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Human takeover banner */}
          {conv.human_takeover && (
            <div className="mx-4 sm:mx-6 mt-4 px-4 py-2.5 bg-[#1a1f36] text-white rounded-xl flex items-center gap-2 flex-shrink-0">
              <User className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm font-medium">You are now handling this conversation</p>
            </div>
          )}

          {/* AI Summary */}
          {conv.summary && (
            <div className="mx-4 sm:mx-6 mt-4 p-3 sm:p-4 bg-[#4ecdc4]/5 rounded-xl border border-[#4ecdc4]/20 flex-shrink-0">
              <p className="text-xs font-semibold text-[#3db8af] mb-1">AI Summary</p>
              <p className="text-sm text-gray-700">{conv.summary}</p>
            </div>
          )}

          {/* Transcript */}
          <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
            {(messages || []).map((msg) => {
              const isAgent = msg.role === 'agent'
              const isOutbound = msg.role === 'assistant' || isAgent
              return (
                <div
                  key={msg.id}
                  className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 ${
                      isAgent
                        ? 'bg-[#1a1f36] text-white rounded-br-sm'
                        : msg.role === 'assistant'
                        ? 'bg-[#4ecdc4] text-white rounded-br-sm'
                        : 'bg-white border border-gray-100 text-gray-900 rounded-bl-sm'
                    }`}
                  >
                    {isAgent && (
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/60 mb-0.5">Agent</p>
                    )}
                    <p className="text-sm">{msg.content}</p>
                    <p className={`text-xs mt-1 ${isOutbound ? 'text-white/70' : 'text-gray-400'}`}>
                      {formatDateTime(msg.timestamp)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Manual message composer — only when a human has taken over */}
          {conv.human_takeover && <MessageComposer conversationId={id} />}
        </div>

        {/* Contact Sidebar — desktop only */}
        <div className="w-64 border-l border-gray-100 bg-white p-4 overflow-auto flex-shrink-0 hidden lg:block">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Contact</h3>

          <div className="space-y-3">
            {contact?.name && (
              <div className="flex items-center gap-2 text-sm">
                <User className="w-4 h-4 text-gray-400" />
                <span className="text-gray-700">{contact.name}</span>
              </div>
            )}
            {ident && (
              <div className="flex items-start gap-2 text-sm">
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
            {contact?.email && (
              <div className="flex items-center gap-2 text-sm">
                <MessageSquare className="w-4 h-4 text-gray-400" />
                <span className="text-gray-700 truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {contact?.id && (
            <Link href={`/contacts/${contact.id}`} className="mt-4 block text-xs text-[#4ecdc4] hover:underline">
              View full profile →
            </Link>
          )}

          <div className="mt-6 pt-4 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Details</h3>
            <div className="space-y-2 text-xs text-gray-500">
              <div className="flex justify-between">
                <span>Channel</span>
                <Badge variant={conv.channel as 'sms' | 'voice' | 'whatsapp' | 'instagram' | 'facebook'}>
                  {conv.channel}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span>Sentiment</span>
                {conv.sentiment ? (
                  <Badge variant={conv.sentiment as 'positive' | 'neutral' | 'negative'}>{conv.sentiment}</Badge>
                ) : <span>—</span>}
              </div>
              <div className="flex justify-between">
                <span>Messages</span>
                <span className="font-medium text-gray-700">{messages?.length || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

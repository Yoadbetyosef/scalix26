import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Phone, MessageSquare, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatDateTime, formatDate } from '@/lib/utils'
import { ConversationActions } from '@/components/inbox/conversation-actions'

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user.id).single()
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

  return (
    <div className="flex flex-col h-screen max-h-screen">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 bg-white border-b border-gray-100 flex-shrink-0">
        <Link href="/inbox" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-medium">
          {contact?.name?.[0] || contact?.phone?.[0] || '?'}
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-gray-900">
            {contact?.name || contact?.phone || 'Unknown'}
          </h2>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{conv.channel}</span>
            <span>·</span>
            <span>{formatDate(conv.created_at)}</span>
            {conv.ai_employee && <span>· {(conv.ai_employee as { name: string }).name}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={conv.status as 'open' | 'resolved' | 'closed'}>{conv.status}</Badge>
          <ConversationActions conversationId={id} currentStatus={conv.status} />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Messages */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* AI Summary */}
          {conv.summary && (
            <div className="mx-6 mt-4 p-4 bg-[#4ecdc4]/5 rounded-xl border border-[#4ecdc4]/20 flex-shrink-0">
              <p className="text-xs font-semibold text-[#3db8af] mb-1">AI Summary</p>
              <p className="text-sm text-gray-700">{conv.summary}</p>
            </div>
          )}

          {/* Transcript */}
          <div className="flex-1 overflow-auto p-6 space-y-4">
            {(messages || []).map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'assistant' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
                    msg.role === 'assistant'
                      ? 'bg-[#4ecdc4] text-white rounded-br-sm'
                      : 'bg-white border border-gray-100 text-gray-900 rounded-bl-sm'
                  }`}
                >
                  <p className="text-sm">{msg.content}</p>
                  <p className={`text-xs mt-1 ${msg.role === 'assistant' ? 'text-white/70' : 'text-gray-400'}`}>
                    {formatDateTime(msg.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Contact Sidebar */}
        <div className="w-64 border-l border-gray-100 bg-white p-4 overflow-auto flex-shrink-0 hidden lg:block">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Contact</h3>

          <div className="space-y-3">
            {contact?.name && (
              <div className="flex items-center gap-2 text-sm">
                <User className="w-4 h-4 text-gray-400" />
                <span className="text-gray-700">{contact.name}</span>
              </div>
            )}
            {contact?.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-gray-400" />
                <span className="text-gray-700">{contact.phone}</span>
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

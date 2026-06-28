import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Phone, MessageSquare, MessageCircle, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, formatDate, formatDuration, contactIdentifier, looksLikeName, formatPhone } from '@/lib/utils'
import { getBusinessTimezone } from '@/lib/timezone'

const CHANNEL_LABELS: Record<string, string> = {
  sms: 'SMS', voice: 'Voice', whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', email: 'Email',
}
import { ConversationActions } from '@/components/inbox/conversation-actions'
import { ConversationContactPanel, CustomerProfileBlock } from '@/components/inbox/conversation-contact-panel'
import { HumanTakeover } from '@/components/inbox/human-takeover'
import { MessageComposer } from '@/components/inbox/message-composer'
import { getCustomerProfile } from '@/lib/customer/profile'

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams
  const backHref = from === 'leads' ? '/dashboard?tab=leads' : '/inbox'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: tenant } = await supabase.from('tenants').select('id, timezone').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant) redirect('/auth/signup')

  // Conversation/message times shown in the tenant's business timezone (same source
  // the agent/booking use), consistent with the inbox list.
  const tz = await getBusinessTimezone(tenant.id, tenant.timezone)

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

  // Customer Profile V1 (read-only, additive). Fail-safe: returns an empty profile
  // on any error or missing data, in which case the block hides itself.
  const profile = contact?.id ? await getCustomerProfile(tenant.id, contact.id) : null

  const ident = contactIdentifier(conv.channel, contact?.phone)
  const IdentIcon = ident && !ident.isPhone ? MessageCircle : Phone

  // Same fallback as the inbox list (render-only): show the stored name only if it
  // looks real, otherwise phone + channel — so existing junk-name rows stay consistent.
  const headerTitle = looksLikeName(contact?.name)
    ? contact!.name
    : contact?.phone
      ? `${formatPhone(contact.phone)} · ${CHANNEL_LABELS[conv.channel] || conv.channel}`
      : contact?.email || 'Unknown'

  return (
    <div className="flex flex-col h-screen max-h-screen">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 sm:py-4 bg-white border-b border-hairline flex-shrink-0">
        <Link href={backHref} className="tap-target -ml-2 flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:text-ink hover:bg-sunken flex-shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-medium flex-shrink-0 ${conv.channel === 'voice' ? 'bg-accent/10 text-accent-strong' : 'bg-sunken text-subtle'}`}>
          {conv.channel === 'voice' ? <Phone className="w-4 h-4" /> : (contact?.name?.[0] || contact?.phone?.[0] || '?')}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-ink truncate">
            {headerTitle}
          </h2>
          <div className="flex items-center gap-1.5 text-xs text-subtle flex-wrap">
            <span>{conv.channel === 'voice' ? 'Voice' : conv.channel}</span>
            <span>·</span>
            <span>{formatDate(conv.created_at, tz)}</span>
            {conv.channel === 'voice' && conv.duration_seconds != null && (
              <><span>·</span><span>{formatDuration(conv.duration_seconds)}</span></>
            )}
            {conv.ai_employee && <><span>·</span><span className="truncate">{(conv.ai_employee as { name: string }).name}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
          <Badge variant={conv.status as 'open' | 'resolved' | 'closed'}>{conv.status}</Badge>
          <HumanTakeover conversationId={id} active={conv.human_takeover === true} />
          <ConversationActions conversationId={id} currentStatus={conv.status} />
          {/* Mobile contact info trigger */}
          <ConversationContactPanel contact={contactInfo} profile={profile} />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Messages */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Human takeover banner */}
          {conv.human_takeover && (
            <div className="mx-4 sm:mx-6 mt-4 px-4 py-2.5 bg-ink text-white rounded-2xl flex items-center gap-2 flex-shrink-0">
              <User className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm font-medium">You are now handling this conversation</p>
            </div>
          )}

          {/* AI Summary */}
          {conv.summary && (
            <div className="mx-4 sm:mx-6 mt-4 p-3 sm:p-4 bg-accent/[0.06] rounded-2xl border border-accent/15 flex-shrink-0">
              <p className="text-xs font-semibold text-accent-strong mb-1">AI Summary</p>
              <p className="text-sm text-ink">{conv.summary}</p>
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
                        ? 'bg-ink text-white rounded-br-md ring-1 ring-accent/40'
                        : msg.role === 'assistant'
                        ? 'bg-ink text-white rounded-br-md'
                        : 'bg-sunken text-ink rounded-bl-md'
                    }`}
                  >
                    {isAgent && (
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-accent/90 mb-0.5">You · Agent</p>
                    )}
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                    <p className={`text-xs mt-1 ${isOutbound ? 'text-white/55' : 'text-muted'}`}>
                      {formatDateTime(msg.timestamp, tz)}
                    </p>
                    {/* A2: surface a failed/undelivered SMS so it never looks "sent" silently. */}
                    {isOutbound && (msg.delivery_status === 'undelivered' || msg.delivery_status === 'failed') && (
                      <p className="text-xs mt-1 font-medium text-red-200 bg-red-600/30 rounded px-1.5 py-0.5 inline-block">
                        ⚠ Not delivered{msg.error_code ? ` (error ${msg.error_code})` : ''}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Manual message composer — only when a human has taken over */}
          {conv.human_takeover && <MessageComposer conversationId={id} />}
        </div>

        {/* Contact Sidebar — desktop only */}
        <div className="w-64 border-l border-hairline bg-white p-4 overflow-auto flex-shrink-0 hidden lg:block">
          <h3 className="text-xs font-semibold text-subtle uppercase tracking-wide mb-3">Contact</h3>

          <div className="space-y-3">
            {contact?.name && (
              <div className="flex items-center gap-2 text-sm">
                <User className="w-4 h-4 text-muted" />
                <span className="text-ink">{contact.name}</span>
              </div>
            )}
            {ident && (
              <div className="flex items-start gap-2 text-sm">
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
            {contact?.email && (
              <div className="flex items-center gap-2 text-sm">
                <MessageSquare className="w-4 h-4 text-muted" />
                <span className="text-ink truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {contact?.id && (
            <Link href={`/contacts/${contact.id}`} className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-subtle hover:text-ink transition-colors">
              View full profile →
            </Link>
          )}

          <div className="mt-6 pt-4 border-t border-hairline">
            <h3 className="text-xs font-semibold text-subtle uppercase tracking-wide mb-3">Details</h3>
            <div className="space-y-2 text-xs text-subtle">
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
                <span className="font-medium text-ink">{messages?.length || 0}</span>
              </div>
            </div>
          </div>

          <CustomerProfileBlock profile={profile} className="mt-6 pt-4" />
        </div>
      </div>
    </div>
  )
}

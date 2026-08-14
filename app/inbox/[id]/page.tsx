import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Phone, MessageSquare, MessageCircle, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, formatDate, formatDuration, contactIdentifier, looksLikeName, isSocialChannel } from '@/lib/utils'
import { formatPhone } from '@/lib/format'
import { readConversation } from '@/lib/inbox/conversation-read'

const CHANNEL_LABELS: Record<string, string> = {
  sms: 'SMS', voice: 'Voice', whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', email: 'Email',
}
import { ConversationActions } from '@/components/inbox/conversation-actions'
import { ConversationContactPanel, CustomerProfileBlock } from '@/components/inbox/conversation-contact-panel'
import { HumanTakeover } from '@/components/inbox/human-takeover'
import { MessageComposer } from '@/components/inbox/message-composer'
import { AiSummaryCard } from '@/components/inbox/ai-summary-card'
import { getCustomerProfile } from '@/lib/customer/profile'

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams
  const backHref = from === 'leads' ? '/dashboard?tab=leads' : '/inbox'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Admin client (operator-safe; createServiceClient would RLS-scope to the partner's own tenant) +
  // server-validated tenantId. The conversation is filtered by tenant_id; messages by its verified id.
  const service = createAdminClient()
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/auth/signup')
  // Moved to lib/inbox/conversation-read.ts so /v2's conversation screen reads the same rows. Same
  // queries, same join, same ordering — see that file's header.
  const { id } = await params
  const read = await readConversation(tenantId, id)
  if (!read) notFound()
  const { tz, conv, messages } = read

  const contact = conv.contact as { id: string; name?: string; phone?: string; email?: string; address?: string } | null

  const contactInfo = {
    id: contact?.id,
    name: contact?.name,
    phone: contact?.phone,
    email: contact?.email,
    channel: conv.channel,
    sentiment: conv.sentiment ?? undefined,
    messageCount: messages?.length || 0,
  }

  // Customer Profile V1 (read-only, additive). Fail-safe: returns an empty profile
  // on any error or missing data, in which case the block hides itself.
  const profile = contact?.id ? await getCustomerProfile(tenantId, contact.id) : null

  const ident = contactIdentifier(conv.channel, contact?.phone)
  const IdentIcon = ident && !ident.isPhone ? MessageCircle : Phone

  // Header title (C3 — I3/G4 naming, display-only). Never show a raw platform id:
  //  • real-looking stored name → use it
  //  • social channel (Instagram/Facebook) with no name → "Instagram lead" / "Facebook lead"
  //  • voice/sms/whatsapp → formatPhone(number) (G4)
  //  • email → email address
  //  • else → "Unknown"
  const headerTitle = looksLikeName(contact?.name)
    ? contact!.name
    : isSocialChannel(conv.channel)
      ? `${CHANNEL_LABELS[conv.channel] || conv.channel} lead`
      : contact?.phone
        ? formatPhone(contact.phone)
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
            {/* C3: date moved out of the header on mobile (dates live in the messages);
                desktop keeps it via max-md:hidden so md+ stays pixel-identical. */}
            <span className="max-md:hidden">·</span>
            <span className="max-md:hidden">{formatDate(conv.created_at, tz)}</span>
            {conv.channel === 'voice' && conv.duration_seconds != null && (
              <><span>·</span><span>{formatDuration(conv.duration_seconds)}</span></>
            )}
            {conv.ai_employee && <><span>·</span><span className="truncate">{(conv.ai_employee as { name: string }).name}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
          <Badge variant={conv.status as 'open' | 'resolved' | 'closed'}>{conv.status}</Badge>
          {/* C1: top action buttons — desktop only. On mobile they move to the sticky
              bottom bar below; SAME components/handlers, just relocated (max-md:hidden). */}
          <div className="hidden md:flex items-center gap-1.5">
            <HumanTakeover conversationId={id} active={conv.human_takeover === true} />
            <ConversationActions conversationId={id} currentStatus={conv.status} />
          </div>
          {/* Mobile contact info trigger — also hosts "Close" in its menu on mobile (C1). */}
          <ConversationContactPanel contact={contactInfo} profile={profile} conversationId={id} currentStatus={conv.status} />
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

          {/* AI Summary — C2: mobile clamps to 2 lines with a More toggle (client
              component holds pure UI state); desktop shows full text as before. */}
          {conv.summary && <AiSummaryCard summary={conv.summary} />}

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
                        ? 'bg-accent-strong text-white rounded-br-md'
                        : msg.role === 'assistant'
                        ? 'bg-accent text-white rounded-br-md'
                        : 'bg-sunken text-ink rounded-bl-md'
                    }`}
                  >
                    {isAgent && (
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70 mb-0.5">You · Agent</p>
                    )}
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                    <p className={`text-xs mt-1 ${isOutbound ? 'text-white/60' : 'text-muted'}`}>
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

      {/* C1: mobile sticky bottom action bar. md:hidden so desktop is untouched; the
          buttons here reuse the SAME HumanTakeover / ConversationActions handlers as
          the (now desktop-only) top bar. Safe-area aware via .safe-area-inset-bottom. */}
      <div className="md:hidden flex-shrink-0 bg-white border-t border-hairline px-4 pt-3 pb-3 safe-area-inset-bottom">
        <div className="flex items-center gap-2">
          <HumanTakeover conversationId={id} active={conv.human_takeover === true} mobileBar />
          <ConversationActions conversationId={id} currentStatus={conv.status} place="bar" />
        </div>
      </div>
    </div>
  )
}

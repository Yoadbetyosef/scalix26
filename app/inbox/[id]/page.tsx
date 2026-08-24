import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Mail, MessageCircle, Phone, User } from 'lucide-react'
import { RobotAvatar } from '@/components/brand/robot-avatar'
import { formatDateTime, formatDate, formatDuration, contactIdentifier, looksLikeName, isSocialChannel } from '@/lib/utils'
import { formatPhone } from '@/lib/format'
import { readConversation } from '@/lib/inbox/conversation-read'

const CHANNEL_LABELS: Record<string, string> = {
  sms: 'SMS', voice: 'Voice', whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', email: 'Email',
}
import { ConversationActions } from '@/components/inbox/conversation-actions'
import { ConversationContactPanel, CustomerProfileBlock, Chip, CHANNEL_HUE } from '@/components/inbox/conversation-contact-panel'
import { HumanTakeover } from '@/components/inbox/human-takeover'
import { MessageComposer } from '@/components/inbox/message-composer'
import { AiSummaryCard } from '@/components/inbox/ai-summary-card'
import { getCustomerProfile } from '@/lib/customer/profile'

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  // `?from=leads` used to send you back to the Leads tab; the tab is gone, and so is the only
  // thing that produced the parameter. Back is the inbox.
  const backHref = '/inbox'

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

  // Status wears the same chip as everything else, in its own hue: open is the live one, resolved the
  // settled one, closed the muted one. Channel hue comes from the list, so the row's colour follows
  // the conversation in.
  const STATUS_HUE: Record<string, string> = {
    open: 'var(--v2-t1)', resolved: 'var(--v2-t2)', closed: 'var(--v2-ink-45)',
  }
  const chanHue = CHANNEL_HUE[conv.channel] ?? 'var(--v2-t1)'

  return (
    // `v2` for the tokens, `v2-embedded` so the shell's 100dvh does not fight the page's own
    // h-screen scroll frame. Same frame, same behaviour.
    <div className="v2 v2-embedded flex flex-col h-screen max-h-screen">
      {/* Header. Same five things in the same order; the back arrow and the avatar are the kit's round
          icon button and the one face, so the row no longer opens with a grey square and a letter. */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b border-hairline flex-shrink-0">
        <Link href={backHref} className="v2-ico tap-target" aria-label="Back">
          <ArrowLeft />
        </Link>
        <RobotAvatar size={36} />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--v2-ink)' }}>
            {headerTitle}
          </h2>
          <div className="v2-kick flex-wrap" style={{ gap: 6 }}>
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
          <Chip value={conv.status} hue={STATUS_HUE[conv.status] ?? 'var(--v2-ink-45)'} />
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
          {/* An alert, not a coloured block — the same move the kit made on the amber upgrade panel.
              v1 filled the full width with solid ink, which read as a header for the transcript under
              it rather than a warning about it. The badge carries the urgency, the sentence carries
              the fact, and the paper stays paper. */}
          {conv.human_takeover && (
            <div className="v2-notice mx-4 sm:mx-6 mt-4 flex-shrink-0" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
              <span className="v2-chip-sq"><User /></span>
              <p>You are handling this conversation. The AI will not reply until you hand it back.</p>
              <em>Manual</em>
            </div>
          )}

          {/* AI Summary — C2: mobile clamps to 2 lines with a More toggle (client
              component holds pure UI state); desktop shows full text as before. */}
          {conv.summary && <AiSummaryCard summary={conv.summary} />}

          {/* Transcript — .v2-thread, the kit's own, which is also /v2's: a column with a 660px measure
              and 10px between turns. v1 wrapped every message in a full-width flex row and pushed it
              left or right; the thread does that with align-self, so a bubble is as wide as it needs
              to be rather than 78% of whatever the window happens to be. */}
          <div className="flex-1 overflow-auto p-4 sm:p-6">
            <div className="v2-thread">
              {(messages || []).map((msg) => {
                const isAgent = msg.role === 'agent'
                const isOutbound = msg.role === 'assistant' || isAgent
                return (
                  /* One hue for the side that is the product, hairline paper for the customer — not two
                     violets told apart by alignment. The agent and the assistant share the hue because
                     they are the same side of the conversation; which of them spoke is what the label
                     above says. */
                  <div key={msg.id} className="v2-bub" data-who={isOutbound ? 'us' : 'them'}>
                    {isAgent && (
                      <p className="v2-kick" style={{ color: 'rgba(255,255,255,.75)', marginBottom: 2 }}>You · Agent</p>
                    )}
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                    <time className={isOutbound ? '' : 'text-muted'}>
                      {formatDateTime(msg.timestamp, tz)}
                    </time>
                    {/* A2: surface a failed/undelivered SMS so it never looks "sent" silently. */}
                    {isOutbound && (msg.delivery_status === 'undelivered' || msg.delivery_status === 'failed') && (
                      <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t4)', marginTop: 4, background: 'rgba(255,255,255,.22)', color: '#fff' }}>
                        Not delivered{msg.error_code ? ` · ${msg.error_code}` : ''}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Manual message composer — only when a human has taken over */}
          {conv.human_takeover && <MessageComposer conversationId={id} />}
        </div>

        {/* Contact rail — desktop only. The same two columns the mobile sheet shows, because they are
            the same facts; .v2-facts is that pair, and .v2-kick is the section label the rail's own
            groups use. The identity block keeps its icons: a phone number that is a phone number and
            an email that is an email is the one place on this screen where an icon says something the
            label does not. */}
        <div className="w-64 border-l border-hairline p-5 overflow-auto flex-shrink-0 hidden lg:block">
          <p className="v2-kick" style={{ marginBottom: 12 }}>Contact</p>

          <div className="space-y-3">
            {contact?.name && (
              <div className="flex items-center gap-2 text-sm">
                <User className="w-4 h-4" style={{ color: 'var(--v2-ink-45)' }} />
                <span style={{ color: 'var(--v2-ink)' }}>{contact.name}</span>
              </div>
            )}
            {ident && (
              <div className="flex items-start gap-2 text-sm">
                <IdentIcon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--v2-ink-45)' }} />
                <div className="min-w-0">
                  {ident.isPhone ? (
                    <a href={`tel:${ident.value}`} className="font-medium hover:underline break-all" style={{ color: 'var(--v2-ink)' }}>{ident.value}</a>
                  ) : (
                    <span className="break-all" style={{ color: 'var(--v2-ink)' }}>{ident.value}</span>
                  )}
                  <p className="v2-kick" style={{ marginTop: 2 }}>{ident.label}</p>
                </div>
              </div>
            )}
            {contact?.email && (
              <div className="flex items-center gap-2 text-sm min-w-0">
                <Mail className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--v2-ink-45)' }} />
                <span className="truncate" style={{ color: 'var(--v2-ink)' }}>{contact.email}</span>
              </div>
            )}
          </div>

          {contact?.id && (
            <Link href={`/contacts/${contact.id}`} className="v2-act" style={{ marginTop: 16 }}>
              View full profile →
            </Link>
          )}

          <div className="mt-6 pt-5 border-t border-hairline">
            <p className="v2-kick" style={{ marginBottom: 12 }}>Details</p>
            <dl className="v2-facts" data-narrow>
              <div><dt>Channel</dt><dd><Chip value={conv.channel} hue={chanHue} /></dd></div>
              <div>
                <dt>Sentiment</dt>
                <dd>{conv.sentiment
                  ? <Chip value={conv.sentiment} hue={conv.sentiment === 'positive' ? 'var(--v2-t2)' : conv.sentiment === 'negative' ? 'var(--v2-t4)' : 'var(--v2-ink-45)'} />
                  : '—'}</dd>
              </div>
              <div><dt>Messages</dt><dd>{messages?.length || 0}</dd></div>
            </dl>
          </div>

          <CustomerProfileBlock profile={profile} className="mt-6 pt-5 border-t border-hairline" />
        </div>
      </div>

      {/* C1: mobile sticky bottom action bar. md:hidden so desktop is untouched; the
          buttons here reuse the SAME HumanTakeover / ConversationActions handlers as
          the (now desktop-only) top bar. Safe-area aware via .safe-area-inset-bottom. */}
      <div className="md:hidden flex-shrink-0 border-t border-hairline px-4 pt-3 pb-3 safe-area-inset-bottom">
        <div className="flex items-center gap-2">
          <HumanTakeover conversationId={id} active={conv.human_takeover === true} mobileBar />
          <ConversationActions conversationId={id} currentStatus={conv.status} place="bar" />
        </div>
      </div>
    </div>
  )
}

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { RobotAvatar } from '@/components/brand/robot-avatar'
import { channelHue } from '@/app/(v2)/v2/channels'
import { formatDateTime, formatDuration, truncate, looksLikeName, formatPhone } from '@/lib/utils'
import { relativeTime } from '@/lib/format'
import { getBusinessTimezone } from '@/lib/timezone'

const CHANNEL_LABELS: Record<string, string> = {
  sms: 'SMS',
  voice: 'Voice',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  email: 'Email',
  web: 'Web Chat',
  webchat: 'Web Chat',
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; channel?: string; q?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Admin client (not createServiceClient, which downgrades to the operator's JWT under RLS and would
  // scope to the partner's own tenant) + server-validated tenantId on every query → operator-safe.
  const service = createAdminClient()
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/auth/signup')
  const { data: tenant } = await service
    .from('tenants').select('id, timezone').eq('id', tenantId).maybeSingle()
  if (!tenant) redirect('/auth/signup')

  // Display all conversation times in the tenant's business timezone (same source the
  // agent/booking use), so a shared team sees one consistent, unambiguous time.
  const tz = await getBusinessTimezone(tenant.id, tenant.timezone)

  const params = await searchParams
  const { status = 'all', channel = 'all', q = '' } = params

  let query = service
    .from('conversations')
    .select('*, contact:contacts(name, phone, email)')
    .eq('tenant_id', tenant.id)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (status !== 'all') query = query.eq('status', status)
  if (channel !== 'all') query = query.eq('channel', channel)

  const { data: conversations } = await query

  const filtered = q
    ? (conversations || []).filter(c =>
        c.contact?.name?.toLowerCase().includes(q.toLowerCase()) ||
        c.contact?.phone?.includes(q) ||
        c.summary?.toLowerCase().includes(q.toLowerCase())
      )
    : conversations || []

  // `v2` carries the tokens every promoted class reads; `v2-embedded` undoes the 100dvh and hidden
  // overflow that belong to a route owning the viewport, not to a page inside AppShell.
  return (
    <div className="v2 v2-embedded flex flex-col h-full">
      {/* THE HEADER, /v2's. No page title: the rail already says Inbox, and a 24px repeat of the
          rail's own word is the same label twice. The micro-label carries the count instead — the one
          thing the rail cannot say — and the rule runs to the edge the way every section header in
          this language does. */}
      <div className="p-4 sm:p-6 border-b border-hairline space-y-4">
        <div className="v2-head" style={{ marginBottom: 0 }}>
          <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
            <i />Shared inbox{filtered.length ? ` · ${filtered.length}` : ''}
          </p>
          <s />
        </div>

        {/* Search — a rule, not a box, per the kit. The icon sits on the baseline rather than inside
            a field, because there is no field to sit inside any more. */}
        <form className="v2-fld" style={{ position: 'relative' }}>
          <label htmlFor="inbox-q">Search</label>
          <input id="inbox-q" name="q" defaultValue={q} placeholder="Name, number or message…" style={{ paddingRight: 24 }} />
          <Search className="w-4 h-4" style={{ position: 'absolute', right: 0, bottom: 10, color: 'var(--v2-mute)' }} />
        </form>

        {/* Filters. Same two groups, same hrefs, same behaviour — /v2's own .v2-chip, which already
            has the selected state this needs, instead of v1's ink-filled pill. */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5 max-md:-mx-4 max-md:px-4 md:contents">
          <div className="contents md:flex md:gap-2 md:overflow-x-auto md:no-scrollbar md:pb-0.5">
            {['all', 'open', 'resolved', 'closed'].map(s => (
              <Link
                key={s}
                href={`/inbox?status=${s}&channel=${channel}&q=${q}`}
                className="v2-chip flex-shrink-0 capitalize"
                data-on={status === s || undefined}
              >
                {s}
              </Link>
            ))}
          </div>

          <div className="contents md:flex md:gap-2 md:overflow-x-auto md:no-scrollbar md:pb-0.5">
            {['all', 'sms', 'voice', 'email', 'instagram', 'facebook'].map(c => (
              <Link
                key={c}
                href={`/inbox?status=${status}&channel=${c}&q=${q}`}
                className="v2-chip flex-shrink-0"
                data-on={channel === c || undefined}
              >
                {c !== 'all' && <i className="v2-gdot" style={{ ['--ghue' as string]: channelHue(c) }} />}
                {c === 'all' ? 'All Channels' : CHANNEL_LABELS[c]}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          (q || status !== 'all' || channel !== 'all') ? (
            <div className="p-4 sm:p-6">
              <div className="v2-card" data-empty>
                <b>Nothing matches those filters</b>
                <span>Clear the search or choose another channel.</span>
              </div>
            </div>
          ) : (
            <div className="p-4 sm:p-6">
              <div className="v2-card" data-empty>
                <b>Your AI employee is ready</b>
                <span>The moment someone calls, texts, emails or messages your business, the conversation appears here — answered, summarised and ready for you.</span>
              </div>
            </div>
          )
        ) : (
          <div className="v2-list sx-stagger">
            {filtered.map((conv) => {
              const contact = conv.contact as { name?: string; phone?: string; email?: string } | null
              const channelLabel = CHANNEL_LABELS[conv.channel] || conv.channel
              // I3 — mobile display-only title: never show raw platform IDs. If no real
              // name, Instagram → "Instagram lead"; Voice/SMS → formatPhone(number);
              // Email → email. Falls back to a friendly channel label, never an ID.
              const mobileTitle = looksLikeName(contact?.name)
                ? contact!.name
                : conv.channel === 'instagram' || conv.channel === 'facebook'
                  ? `${channelLabel} lead`
                  : (conv.channel === 'voice' || conv.channel === 'sms' || conv.channel === 'whatsapp') && contact?.phone
                    ? formatPhone(contact.phone)
                    : conv.channel === 'email' && contact?.email
                      ? contact.email
                      : contact?.email || `${channelLabel} lead`
              // I4 — unread. No dedicated column exists; derive from the live/open signal.
              // If an unread_count is ever added it lights the badge automatically (>1).
              const unreadCount = typeof (conv as { unread_count?: number }).unread_count === 'number'
                ? (conv as { unread_count?: number }).unread_count!
                : 0
              const isUnread = unreadCount > 0 || conv.status === 'open'
              const preview = conv.summary
                ? truncate(conv.summary, 64)
                : conv.channel === 'voice'
                  ? (conv.duration_seconds != null ? `Voice call · ${formatDuration(conv.duration_seconds)}` : 'Voice call')
                  : 'No summary yet'
              return (
                <Link key={conv.id} href={`/inbox/${conv.id}`} className="v2-row tap-target" data-click
                      style={{ ['--chan' as string]: channelHue(conv.channel) }}>
                  {/* ONE ROW, BOTH WIDTHS, AND IT IS /v2's OWN. v1 carried two — a flat list on mobile and
                      a shadowed, channel-tinted card on desktop — which is two components to keep in step,
                      and they had already drifted: the mobile one showed a friendly title where the desktop
                      one printed a raw contact initial in a coloured circle. .v2-row is the row /v2 already
                      uses for its lists, so the only additions are the ones a conversation needs and a
                      dashboard list never did: the one face, a channel chip, and a second trailing value.
                      The mobile title rule wins because it is the better one; the desktop-only absolute
                      date survives as the wider screen's extra column. */}
                  <RobotAvatar size={38} className="v2-av" />
                  <div className="v2-m">
                    <p className="flex items-center gap-2 min-w-0">
                      <span className="truncate">{mobileTitle}</span>
                      {isUnread && <span className="v2-dot" aria-hidden="true" />}
                      {unreadCount > 1 && <span className="v2-stat">{unreadCount}</span>}
                      <span className="v2-stat">{channelLabel}</span>
                    </p>
                    <span>{preview}</span>
                  </div>
                  <div className="v2-meta">
                    <em>{conv.status}</em>
                    <em className="max-md:hidden">{formatDateTime(conv.updated_at, tz)}</em>
                    <em className="md:hidden">{relativeTime(conv.updated_at)}</em>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

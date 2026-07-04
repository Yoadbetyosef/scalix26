import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { MessageCircle, Search, Phone, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
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

// Soft channel palette — the website's color language. Color recognizes the channel
// before you read a word. Kept soft (50/100 tints), never saturated.
const CHANNEL_STYLE: Record<string, { tint: string; ring: string; badge: string; avatar: string; dot: string }> = {
  sms: { tint: 'bg-amber-50', ring: 'ring-amber-100', badge: 'bg-amber-100 text-amber-700', avatar: 'bg-amber-100 text-amber-600', dot: 'bg-amber-400' },
  email: { tint: 'bg-blue-50', ring: 'ring-blue-100', badge: 'bg-blue-100 text-blue-700', avatar: 'bg-blue-100 text-blue-600', dot: 'bg-blue-400' },
  instagram: { tint: 'bg-pink-50', ring: 'ring-pink-100', badge: 'bg-pink-100 text-pink-700', avatar: 'bg-pink-100 text-pink-600', dot: 'bg-pink-400' },
  facebook: { tint: 'bg-purple-50', ring: 'ring-purple-100', badge: 'bg-purple-100 text-purple-700', avatar: 'bg-purple-100 text-purple-600', dot: 'bg-purple-400' },
  voice: { tint: 'bg-green-50', ring: 'ring-green-100', badge: 'bg-green-100 text-green-700', avatar: 'bg-green-100 text-green-600', dot: 'bg-green-400' },
  whatsapp: { tint: 'bg-emerald-50', ring: 'ring-emerald-100', badge: 'bg-emerald-100 text-emerald-700', avatar: 'bg-emerald-100 text-emerald-600', dot: 'bg-emerald-400' },
  web: { tint: 'bg-cyan-50', ring: 'ring-cyan-100', badge: 'bg-cyan-100 text-cyan-700', avatar: 'bg-cyan-100 text-cyan-600', dot: 'bg-cyan-400' },
  webchat: { tint: 'bg-cyan-50', ring: 'ring-cyan-100', badge: 'bg-cyan-100 text-cyan-700', avatar: 'bg-cyan-100 text-cyan-600', dot: 'bg-cyan-400' },
}
const NEUTRAL = { tint: 'bg-white', ring: 'ring-hairline', badge: 'bg-sunken text-subtle', avatar: 'bg-sunken text-subtle', dot: 'bg-muted' }

// Activity → energy. Open conversations wear their channel color; resolved fade to a
// calm white card (channel still recognizable in the badge); closed go quiet gray.
function rowStyle(channel: string, status: string | null) {
  const c = CHANNEL_STYLE[channel] || NEUTRAL
  if (status === 'open') return { card: `${c.tint} ring-1 ${c.ring}`, badge: c.badge, avatar: c.avatar, dot: c.dot, live: true }
  if (status === 'resolved') return { card: 'bg-white ring-1 ring-hairline', badge: c.badge, avatar: c.avatar, dot: c.dot, live: false }
  return { card: 'bg-white ring-1 ring-hairline', badge: 'bg-sunken text-muted', avatar: 'bg-sunken text-muted', dot: 'bg-muted', live: false }
}

const RECENT_MS = 24 * 60 * 60 * 1000

// Mobile-only (I2): 38px circular channel avatar colors. Instagram=pink, Voice=green,
// SMS=teal, Email=blue; everything else falls back to a neutral tile.
const MOBILE_AVATAR: Record<string, string> = {
  instagram: 'bg-pink-100 text-pink-600',
  voice: 'bg-green-100 text-green-600',
  sms: 'bg-teal-100 text-teal-600',
  email: 'bg-blue-100 text-blue-600',
}
const MOBILE_AVATAR_FALLBACK = 'bg-sunken text-subtle'

// Mobile-only (I5): status → colored dot. blue=open, green=resolved, gray=closed.
function mobileStatusDot(status: string | null): string {
  if (status === 'open') return 'bg-blue-500'
  if (status === 'resolved') return 'bg-emerald-500'
  return 'bg-muted'
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; channel?: string; q?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: tenant } = await supabase
    .from('tenants').select('id, timezone').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant) redirect('/auth/signup')

  // Display all conversation times in the tenant's business timezone (same source the
  // agent/booking use), so a shared team sees one consistent, unambiguous time.
  const tz = await getBusinessTimezone(tenant.id, tenant.timezone)

  const params = await searchParams
  const { status = 'all', channel = 'all', q = '' } = params

  let query = supabase
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

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 sm:p-6 border-b border-hairline bg-white space-y-3">
        <h1 className="text-2xl font-light tracking-tight text-ink">Shared Inbox</h1>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <form>
            <input
              name="q"
              defaultValue={q}
              placeholder="Search conversations..."
              className="pl-10 h-11 w-full rounded-xl border border-hairline bg-white text-sm text-ink placeholder:text-muted outline-none transition-shadow duration-200 focus:border-ink/15 focus:shadow-[0_0_0_4px_rgba(26,31,54,0.04)]"
            />
          </form>
        </div>

        {/* Filters. Mobile (I1): status + channel chips merge into ONE horizontally
            scrollable row (chips flex-shrink-0, 32px tall). Desktop: two stacked rows,
            unchanged — `md:contents` on the wrapper dissolves it back into the parent's
            space-y-3 flow so each inner div is its own row again. */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5 max-md:-mx-4 max-md:px-4 md:contents">
          {/* Status filters — scrollable row */}
          <div className="contents md:flex md:gap-2 md:overflow-x-auto md:no-scrollbar md:pb-0.5">
            {['all', 'open', 'resolved', 'closed'].map(s => (
              <Link
                key={s}
                href={`/inbox?status=${s}&channel=${channel}&q=${q}`}
                className={cn(
                  'flex-shrink-0 px-3.5 rounded-full text-xs font-medium transition-colors capitalize flex items-center max-md:h-8 md:min-h-[40px]',
                  status === s ? 'bg-ink text-white' : 'bg-sunken text-subtle hover:bg-hairline-strong'
                )}
              >
                {s}
              </Link>
            ))}
          </div>

          {/* Channel filters — scrollable row */}
          <div className="contents md:flex md:gap-2 md:overflow-x-auto md:no-scrollbar md:pb-0.5">
            {['all', 'sms', 'voice', 'email', 'instagram', 'facebook'].map(c => (
              <Link
                key={c}
                href={`/inbox?status=${status}&channel=${c}&q=${q}`}
                className={cn(
                  'flex-shrink-0 px-3.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 max-md:h-8 md:min-h-[40px]',
                  channel === c ? 'bg-ink text-white' : 'bg-sunken text-subtle hover:bg-hairline-strong'
                )}
              >
                {c !== 'all' && (
                  <span className={cn('h-1.5 w-1.5 rounded-full', channel === c ? 'bg-white/70' : (CHANNEL_STYLE[c]?.dot || 'bg-muted'))} />
                )}
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
            <div className="flex flex-col items-center justify-center h-64 text-muted">
              <MessageCircle className="w-10 h-10 mb-2" strokeWidth={1.5} />
              <p className="text-sm">No conversations match your filters</p>
            </div>
          ) : (
            <EmptyState icon={MessageCircle} title="Your AI employee is ready">
              The moment someone calls, texts, emails, or messages your business, the conversation appears here — answered, summarized, and ready for you.
            </EmptyState>
          )
        ) : (
          <div className="max-md:space-y-0 md:space-y-2 max-md:p-0 md:p-4 sx-stagger">
            {filtered.map((conv) => {
              const contact = conv.contact as { name?: string; phone?: string; email?: string } | null
              const channelLabel = CHANNEL_LABELS[conv.channel] || conv.channel
              // Desktop title (unchanged).
              const title = looksLikeName(contact?.name)
                ? contact!.name
                : contact?.phone
                  ? `${formatPhone(contact.phone)} · ${channelLabel}`
                  : contact?.email || 'Unknown'
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
              const s = rowStyle(conv.channel, conv.status)
              const recent = conv.updated_at ? Date.now() - new Date(conv.updated_at).getTime() < RECENT_MS : false
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
                <Link key={conv.id} href={`/inbox/${conv.id}`} className="tap-target block">
                  {/* MOBILE (I2–I5): flat list row, hairline divider, no card / no unread tint. */}
                  <div className="md:hidden flex items-center gap-3 border-b border-hairline px-4 min-h-[64px] py-3 transition-colors active:bg-sunken">
                    <div className={cn('w-[38px] h-[38px] rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0', MOBILE_AVATAR[conv.channel] || MOBILE_AVATAR_FALLBACK)}>
                      {conv.channel === 'voice'
                        ? <Phone className="w-4 h-4" />
                        : conv.channel === 'email'
                          ? <Mail className="w-4 h-4" />
                          : (looksLikeName(contact?.name) ? contact!.name![0] : channelLabel[0])}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className={cn('text-[15px] text-ink truncate', isUnread ? 'font-semibold' : 'font-normal')}>{mobileTitle}</p>
                        {isUnread && <span className="h-2 w-2 rounded-full bg-accent flex-shrink-0" aria-hidden="true" />}
                        {unreadCount > 1 && (
                          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[11px] font-semibold flex-shrink-0">{unreadCount}</span>
                        )}
                      </div>
                      <p className="text-[13px] text-subtle truncate min-w-0">{preview}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0 ml-1">
                      <span className="text-[12px] text-muted whitespace-nowrap">{relativeTime(conv.updated_at)}</span>
                      <span className={cn('h-2 w-2 rounded-full', mobileStatusDot(conv.status))} aria-hidden="true" title={conv.status ?? undefined} />
                    </div>
                  </div>

                  {/* DESKTOP: original card, unchanged. */}
                  <div className={cn('hidden md:flex items-center gap-3.5 rounded-2xl px-4 py-3.5 transition-all hover:shadow-e2 sm:px-5', s.card)}>
                    <div className={cn('w-11 h-11 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0', s.avatar)}>
                      {conv.channel === 'voice'
                        ? <Phone className="w-4 h-4" />
                        : conv.channel === 'email'
                          ? <Mail className="w-4 h-4" />
                          : (contact?.name?.[0] || contact?.phone?.[0] || contact?.email?.[0] || '?')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="text-[15px] font-medium text-ink truncate">{title}</p>
                        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', s.badge)}>
                          {channelLabel}
                        </span>
                        {s.live && (
                          <span className={cn('h-1.5 w-1.5 rounded-full', s.dot, recent && 'animate-pulse')} aria-hidden="true" />
                        )}
                        {conv.channel === 'voice' && conv.duration_seconds != null && (
                          <span className="text-xs text-muted whitespace-nowrap">{formatDuration(conv.duration_seconds)}</span>
                        )}
                      </div>
                      <p className="text-[13px] text-subtle truncate">{preview}</p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{conv.status}</p>
                      <p className="mt-1 text-xs text-muted whitespace-nowrap">{formatDateTime(conv.updated_at, tz)}</p>
                    </div>
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

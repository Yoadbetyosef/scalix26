import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { MessageCircle, Search, Phone, Mail } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, formatDuration, truncate, looksLikeName, formatPhone } from '@/lib/utils'
import { getBusinessTimezone } from '@/lib/timezone'

const CHANNEL_LABELS: Record<string, string> = {
  sms: 'SMS',
  voice: 'Voice',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  email: 'Email',
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
      <div className="p-4 sm:p-6 border-b border-gray-100 bg-white space-y-3">
        <h1 className="text-xl font-bold text-gray-900">Shared Inbox</h1>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <form>
            <input
              name="q"
              defaultValue={q}
              placeholder="Search conversations..."
              className="pl-9 h-11 w-full rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4ecdc4]"
            />
          </form>
        </div>

        {/* Status filters — scrollable row */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {['all', 'open', 'resolved', 'closed'].map(s => (
            <Link
              key={s}
              href={`/inbox?status=${s}&channel=${channel}&q=${q}`}
              className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors capitalize min-h-[44px] flex items-center ${
                status === s
                  ? 'bg-[#1a1f36] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s}
            </Link>
          ))}
        </div>

        {/* Channel filters — scrollable row */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {['all', 'sms', 'voice', 'email', 'instagram', 'facebook'].map(c => (
            <Link
              key={c}
              href={`/inbox?status=${status}&channel=${c}&q=${q}`}
              className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors min-h-[44px] flex items-center ${
                channel === c
                  ? 'bg-[#4ecdc4] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {c === 'all' ? 'All Channels' : CHANNEL_LABELS[c]}
            </Link>
          ))}
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <MessageCircle className="w-10 h-10 mb-2" />
            <p className="text-sm">No conversations found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map((conv) => {
              const contact = conv.contact as { name?: string; phone?: string; email?: string } | null
              const channelLabel = CHANNEL_LABELS[conv.channel] || conv.channel
              // Show the contact name only if it looks like a real name (not a garbled
              // voice utterance); otherwise fall back to phone + channel, then email.
              const title = looksLikeName(contact?.name)
                ? contact!.name
                : contact?.phone
                  ? `${formatPhone(contact.phone)} · ${channelLabel}`
                  : contact?.email || 'Unknown'
              return (
                <Link key={conv.id} href={`/inbox/${conv.id}`} className="tap-target block">
                  <div className="flex items-center gap-3 px-4 sm:px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 ${conv.channel === 'voice' ? 'bg-[#4ecdc4]/15 text-[#4ecdc4]' : conv.channel === 'email' ? 'bg-indigo-50 text-indigo-500' : 'bg-gray-100 text-gray-600'}`}>
                      {conv.channel === 'voice'
                        ? <Phone className="w-4 h-4" />
                        : conv.channel === 'email'
                          ? <Mail className="w-4 h-4" />
                          : (contact?.name?.[0] || contact?.phone?.[0] || contact?.email?.[0] || '?')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">
                          {title}
                        </p>
                        <Badge variant={conv.channel as 'sms' | 'voice' | 'whatsapp' | 'instagram' | 'facebook'}>
                          {conv.channel === 'voice' ? '📞 ' : conv.channel === 'email' ? '📧 ' : ''}{CHANNEL_LABELS[conv.channel] || conv.channel}
                        </Badge>
                        {conv.channel === 'voice' && conv.duration_seconds != null && (
                          <span className="text-xs text-gray-400 whitespace-nowrap">{formatDuration(conv.duration_seconds)}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {conv.summary
                          ? truncate(conv.summary, 60)
                          : conv.channel === 'voice'
                            ? (conv.duration_seconds != null ? `Voice call · ${formatDuration(conv.duration_seconds)}` : 'Voice call')
                            : 'No summary yet'}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 space-y-1 ml-2">
                      <Badge variant={conv.status as 'open' | 'resolved' | 'closed'}>{conv.status}</Badge>
                      <p className="text-xs text-gray-400 whitespace-nowrap">{formatDateTime(conv.updated_at, tz)}</p>
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

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { MessageCircle, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, truncate } from '@/lib/utils'

const CHANNEL_LABELS: Record<string, string> = {
  sms: 'SMS',
  voice: 'Voice',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
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
    .from('tenants').select('id').eq('user_id', user.id).single()
  if (!tenant) redirect('/auth/signup')

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
      <div className="p-6 border-b border-gray-100 bg-white">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Shared Inbox</h1>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <form>
              <input
                name="q"
                defaultValue={q}
                placeholder="Search conversations..."
                className="pl-9 h-9 w-60 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4ecdc4]"
              />
            </form>
          </div>

          <div className="flex gap-1">
            {['all', 'open', 'resolved', 'closed'].map(s => (
              <Link
                key={s}
                href={`/inbox?status=${s}&channel=${channel}&q=${q}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                  status === s
                    ? 'bg-[#1a1f36] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s}
              </Link>
            ))}
          </div>

          <div className="flex gap-1">
            {['all', 'sms', 'voice', 'whatsapp', 'instagram', 'facebook'].map(c => (
              <Link
                key={c}
                href={`/inbox?status=${status}&channel=${c}&q=${q}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
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
              return (
                <Link key={conv.id} href={`/inbox/${conv.id}`}>
                  <div className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer">
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-sm font-medium flex-shrink-0">
                      {contact?.name?.[0] || contact?.phone?.[0] || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-semibold text-gray-900">
                          {contact?.name || contact?.phone || 'Unknown'}
                        </p>
                        <Badge variant={conv.channel as 'sms' | 'voice' | 'whatsapp' | 'instagram' | 'facebook'}>
                          {CHANNEL_LABELS[conv.channel] || conv.channel}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {conv.summary ? truncate(conv.summary, 80) : 'No summary yet'}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 space-y-1">
                      <Badge variant={conv.status as 'open' | 'resolved' | 'closed'}>{conv.status}</Badge>
                      <p className="text-xs text-gray-400">{formatDateTime(conv.updated_at)}</p>
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

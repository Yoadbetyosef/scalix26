import { type ContextSource, str, num } from '../types'

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')

export const conversationsSource: ContextSource = {
  id: 'search_conversations',
  description:
    "Search this business's conversations across ALL channels (phone calls, SMS, email, WhatsApp, Facebook, Instagram, web chat) — including call transcripts and message text. Use for: what a customer said, recent activity, a specific topic, or a channel's volume.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords to find in the conversation summary or in the actual message/transcript text. Optional.' },
      channel: { type: 'string', description: "Filter to one channel: 'voice','sms','email','whatsapp','facebook','instagram','web'. Optional." },
      status: { type: 'string', description: "Filter: 'open','resolved','closed'. Optional." },
      limit: { type: 'integer', description: 'Max results (default 8).' },
    },
  },
  async run(ctx, args) {
    const query = str(args.query)
    const channel = str(args.channel)
    const status = str(args.status)
    const limit = Math.min(num(args.limit, 8), 15)

    // Keyword search hits the actual transcript/message text, tenant-scoped via an inner
    // join on the conversation's tenant_id (messages have no tenant_id of their own).
    if (query) {
      const { data } = await ctx.db
        .from('messages')
        .select('content, role, timestamp, conversation:conversations!inner(id, channel, status, summary, updated_at, tenant_id, contact:contacts(name, phone))')
        .eq('conversation.tenant_id', ctx.tenantId)
        .ilike('content', `%${query}%`)
        .order('timestamp', { ascending: false })
        .limit(limit)
      if (!data?.length) return `No conversations or transcripts mention "${query}".`
      const lines = data.map((m) => {
        const c = m.conversation as unknown as { channel?: string; status?: string; contact?: { name?: string; phone?: string } | null }
        const who = c?.contact?.name || c?.contact?.phone || 'Unknown'
        return `- [${c?.channel}/${c?.status}] ${who} (${fmtDate(m.timestamp)}): "${(m.content || '').slice(0, 200)}"`
      })
      return `Transcript/message matches for "${query}":\n${lines.join('\n')}`
    }

    let q = ctx.db
      .from('conversations')
      .select('channel, status, summary, updated_at, duration_seconds, contact:contacts(name, phone)')
      .eq('tenant_id', ctx.tenantId)
      .order('updated_at', { ascending: false })
      .limit(limit)
    if (channel) q = q.eq('channel', channel)
    if (status) q = q.eq('status', status)
    const { data } = await q
    if (!data?.length) return 'No matching conversations.'
    const lines = data.map((c) => {
      const contact = c.contact as unknown as { name?: string; phone?: string } | null
      const who = contact?.name || contact?.phone || 'Unknown'
      const dur = c.duration_seconds ? ` (${Math.round(c.duration_seconds / 60)}m call)` : ''
      return `- [${c.channel}/${c.status}] ${who}${dur} ${fmtDate(c.updated_at)}: ${c.summary || '(no summary yet)'}`
    })
    return `Recent conversations${channel ? ` on ${channel}` : ''}:\n${lines.join('\n')}`
  },
}

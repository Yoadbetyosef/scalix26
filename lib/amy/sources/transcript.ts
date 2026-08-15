import { type ContextSource, str } from '../types'

export const transcriptSource: ContextSource = {
  id: 'get_conversation_transcript',
  description:
    "Read the FULL transcript — every message — of a recent conversation, exactly what the customer and the AI said. Use this for 'what did the last customer want', 'what was said', or any detail a summary misses. Defaults to the MOST RECENT conversation. Works for calls, SMS, email, and social.",
  input_schema: {
    type: 'object',
    properties: {
      contact_name_or_phone: { type: 'string', description: 'Limit to a specific customer (name/phone/email). Optional.' },
      channel: { type: 'string', description: "Limit to a channel ('voice','sms','email',…). Optional." },
    },
  },
  async run(ctx, args) {
    const term = str(args.contact_name_or_phone)
    const channel = str(args.channel)

    let contactIds: string[] | null = null
    if (term) {
      const like = `%${term}%`
      const { data: cs } = await ctx.db
        .from('contacts').select('id').eq('tenant_id', ctx.tenantId)
        .or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`).limit(5)
      contactIds = (cs || []).map((c) => c.id)
      if (!contactIds.length) return `No conversations with anyone matching "${term}".`
    }

    let q = ctx.db
      .from('conversations')
      .select('id, channel, status, summary, recap, updated_at, contact:contacts(name, phone)')
      .eq('tenant_id', ctx.tenantId)
      .order('updated_at', { ascending: false })
      .limit(1)
    if (channel) q = q.eq('channel', channel)
    if (contactIds) q = q.in('contact_id', contactIds)
    const { data: convs } = await q
    if (!convs?.length) return 'No conversations yet.'

    const conv = convs[0]
    const contact = conv.contact as unknown as { name?: string; phone?: string } | null
    const who = contact?.name || contact?.phone || 'the customer'
    const date = conv.updated_at ? new Date(conv.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

    const { data: msgs } = await ctx.db
      .from('messages').select('role, content, timestamp')
      .eq('conversation_id', conv.id).order('timestamp', { ascending: true }).limit(60)

    if (!msgs?.length) {
      const written = conv.recap || conv.summary
      return written
        ? `Most recent conversation — ${who} via ${conv.channel} (${date}). No message-level transcript stored, but the summary is: ${written}`
        : `Most recent conversation — ${who} via ${conv.channel} (${date}). No transcript stored yet for this one.`
    }
    const lines = msgs.map((m) => `${m.role === 'user' ? who : 'AI'}: ${(m.content || '').slice(0, 300)}`)
    return `Most recent conversation — ${who} via ${conv.channel} (${date}):\n${lines.join('\n')}`
  },
}

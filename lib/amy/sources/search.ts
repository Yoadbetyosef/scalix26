import { type ContextSource, str, num } from '../types'
import { parseRange } from '../time'

export const searchSource: ContextSource = {
  id: 'search_everything',
  description:
    "Find every customer/conversation that mentions a topic — searches the actual TEXT of all messages across every channel (phone transcripts, SMS, email, WhatsApp, Facebook, Instagram, web). Use for 'find everyone who asked about X', 'who mentioned leaking', 'customers asking for refunds', 'people who wanted Friday', 'who asked about a discount'. Pass a single focused keyword/root (e.g. 'emergency', 'leak', 'refund', 'friday', 'discount').",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A single keyword/root term to find in customers’ messages.' },
      time_range: { type: 'string', description: 'Optional preset window: today, yesterday, this_week, last_week, this_month, last_month, this_year, last_year, last_7_days, last_30_days, last_90_days, all.' },
      from: { type: 'string', description: 'Optional ISO start date for an arbitrary historical window (e.g. "4 months ago", "March"). Use with `to`.' },
      to: { type: 'string', description: 'Optional ISO end date for an arbitrary historical window. Use with `from`.' },
      limit: { type: 'integer', description: 'Max matching messages to scan (default 25).' },
    },
    required: ['query'],
  },
  async run(ctx, args) {
    const query = str(args.query)
    if (!query) return 'Give me a keyword to search for.'
    const limit = Math.min(num(args.limit, 25), 50)
    const ranged = !!(str(args.time_range) || str(args.from) || str(args.to))
    const range = parseRange(str(args.time_range), str(args.from), str(args.to))

    let q = ctx.db
      .from('messages')
      .select('content, timestamp, conversation:conversations!inner(channel, tenant_id, contact:contacts(name, phone))')
      .eq('conversation.tenant_id', ctx.tenantId)
      .ilike('content', `%${query}%`)
      .order('timestamp', { ascending: false })
      .limit(limit)
    if (range.start) q = q.gte('timestamp', range.start)
    if (range.end) q = q.lt('timestamp', range.end)
    const { data } = await q
    if (!data?.length) return `No one mentioned "${query}"${ranged ? ` ${range.label}` : ''}.`

    // De-dupe by customer so Amy gets a clean list of people.
    const seen = new Map<string, { who: string; channel: string; when: string; snippet: string }>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const m of data as any[]) {
      const c = m.conversation
      const who = c?.contact?.name || c?.contact?.phone || 'Unknown'
      if (!seen.has(who)) {
        seen.set(who, { who, channel: c?.channel || '?', when: new Date(m.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), snippet: (m.content || '').slice(0, 160) })
      }
    }
    const lines = [...seen.values()].map((v) => `- ${v.who} (${v.channel}, ${v.when}): "${v.snippet}"`)
    return `${seen.size} customer${seen.size === 1 ? '' : 's'} mentioned "${query}"${ranged ? ` ${range.label}` : ''}:\n${lines.join('\n')}`
  },
}

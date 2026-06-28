import { type ContextSource, str } from '../types'

export const leadsSource: ContextSource = {
  id: 'get_leads',
  description: "Get this business's leads / opportunities (people who reached out and may need follow-up). Use for 'who needs follow-up', 'new leads', pipeline questions.",
  input_schema: {
    type: 'object',
    properties: { status: { type: 'string', description: "Filter: 'new','contacted','booked','dismissed'. Optional." } },
  },
  async run(ctx, args) {
    const status = str(args.status)
    let q = ctx.db
      .from('leads')
      .select('name, phone, source, status, created_at, responded_at')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(20)
    if (status) q = q.eq('status', status)
    const { data } = await q
    if (!data?.length) return status ? `No ${status} leads.` : 'No leads yet.'
    const counts: Record<string, number> = {}
    for (const l of data) counts[l.status] = (counts[l.status] || 0) + 1
    const head = Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ')
    const lines = data.slice(0, 10).map((l) => {
      const waiting = !l.responded_at && (l.status === 'new' || l.status === 'contacted')
      return `- ${l.name || 'Unknown'} (${l.phone || '—'}) · ${l.source} · ${l.status}${waiting ? ' · ⏳ awaiting follow-up' : ''}`
    })
    return `Leads (${head}):\n${lines.join('\n')}`
  },
}

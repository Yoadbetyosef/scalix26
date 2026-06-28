import { type ContextSource, num } from '../types'

export const metricsSource: ContextSource = {
  id: 'get_business_metrics',
  description: "Get this business's headline metrics over a recent window: calls answered, texts handled, total conversations, leads, appointments. Use for performance / 'how did we do' / analytics questions.",
  input_schema: {
    type: 'object',
    properties: { days: { type: 'integer', description: 'Look-back window in days (default 7).' } },
  },
  async run(ctx, args) {
    const days = Math.min(num(args.days, 7), 90)
    const since = new Date(Date.now() - days * 86400000).toISOString()
    const t = ctx.tenantId
    const ev = (channel: string) =>
      ctx.db.from('analytics_events').select('*', { count: 'exact', head: true })
        .eq('tenant_id', t).eq('event_type', 'message_handled').eq('data->>channel', channel).gte('created_at', since)
    const [calls, sms, convs, leads, appts] = await Promise.all([
      ev('voice'),
      ev('sms'),
      ctx.db.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', t).gte('created_at', since),
      ctx.db.from('leads').select('*', { count: 'exact', head: true }).eq('tenant_id', t).gte('created_at', since),
      ctx.db.from('appointments').select('*', { count: 'exact', head: true }).eq('tenant_id', t).neq('status', 'cancelled').gte('created_at', since),
    ])
    return [
      `Business metrics (last ${days} days):`,
      `- Calls answered: ${calls.count || 0}`,
      `- Texts handled: ${sms.count || 0}`,
      `- Total conversations: ${convs.count || 0}`,
      `- New leads: ${leads.count || 0}`,
      `- Appointments booked: ${appts.count || 0}`,
    ].join('\n')
  },
}

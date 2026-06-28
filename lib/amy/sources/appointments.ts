import { type ContextSource, str } from '../types'

export const appointmentsSource: ContextSource = {
  id: 'get_appointments',
  description: "Get this business's booked appointments (today, upcoming, or past). Use for scheduling questions.",
  input_schema: {
    type: 'object',
    properties: { when: { type: 'string', description: "'today', 'upcoming', or 'past'. Default 'upcoming'." } },
  },
  async run(ctx, args) {
    const when = str(args.when) || 'upcoming'
    const today = new Date().toLocaleDateString('en-CA')
    let q = ctx.db
      .from('appointments')
      .select('customer_name, customer_phone, channel, slot_date, slot_time, service_type, status')
      .eq('tenant_id', ctx.tenantId)
      .neq('status', 'cancelled')
    if (when === 'today') q = q.eq('slot_date', today)
    else if (when === 'past') q = q.lt('slot_date', today).order('slot_date', { ascending: false })
    else q = q.gte('slot_date', today).order('slot_date', { ascending: true })
    const { data } = await q.limit(15)
    if (!data?.length) return `No ${when} appointments.`
    const lines = data.map((a) => `- ${a.slot_date} ${a.slot_time} · ${a.customer_name || 'Customer'} · ${a.service_type || 'service'} · ${a.status}`)
    return `${when[0].toUpperCase() + when.slice(1)} appointments:\n${lines.join('\n')}`
  },
}

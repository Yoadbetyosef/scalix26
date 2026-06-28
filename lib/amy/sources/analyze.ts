import { type ContextSource, str } from '../types'
import { parseRange } from '../time'

// Generic analytics over the tenant's data: fetch the relevant columns for a window and
// compute totals / group breakdowns in code. New entities just register here — no new
// "special case" tool per statistic. (Capped at 5000 rows/window; fine for SMB volumes.)
const ENTITIES: Record<string, { table: string; timeField: string; fields: string }> = {
  conversations: { table: 'conversations', timeField: 'created_at', fields: 'channel,status,created_at,duration_seconds' },
  leads: { table: 'leads', timeField: 'created_at', fields: 'status,source,created_at,responded_at' },
  appointments: { table: 'appointments', timeField: 'created_at', fields: 'status,channel,service_type,created_at,slot_date' },
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const analyzeSource: ContextSource = {
  id: 'analyze',
  description:
    "Compute statistics over this business's data: a total, or a breakdown grouped by a field, over a time range. Use for 'how many', 'most common', 'busiest hour/day', 'breakdown by channel/source/service', percentages, trends, conversion, cancellations, and COMPARISONS (call once per period and compare the results). Entities: conversations (calls/texts/social), leads, appointments.",
  input_schema: {
    type: 'object',
    properties: {
      entity: { type: 'string', description: "'conversations', 'leads', or 'appointments'." },
      group_by: { type: 'string', description: 'Break down by: channel, status, source, service_type, hour, day_of_week, or date. Omit for a single total.' },
      time_range: { type: 'string', description: 'today, yesterday, this_week, last_week, this_month, last_month, this_year, last_year, last_7_days, last_30_days, all, or custom (with from/to). Default last_30_days.' },
      from: { type: 'string', description: 'ISO start for custom range.' },
      to: { type: 'string', description: 'ISO end for custom range.' },
      filter_field: { type: 'string', description: 'Optional equality filter field (status, channel, source, service_type).' },
      filter_value: { type: 'string', description: 'Value for filter_field (e.g. cancelled, voice, facebook).' },
      metric: { type: 'string', description: "'count' (default) or 'avg_call_duration'." },
    },
    required: ['entity'],
  },
  async run(ctx, args) {
    const entity = str(args.entity)
    const cfg = ENTITIES[entity]
    if (!cfg) return 'I can analyze: conversations, leads, or appointments.'
    const range = parseRange(str(args.time_range), str(args.from), str(args.to))
    const groupBy = str(args.group_by)
    const metric = str(args.metric) || 'count'
    const ff = str(args.filter_field), fv = str(args.filter_value)

    let q = ctx.db.from(cfg.table).select(cfg.fields).eq('tenant_id', ctx.tenantId).limit(5000)
    if (range.start) q = q.gte(cfg.timeField, range.start)
    if (range.end) q = q.lt(cfg.timeField, range.end)
    if (ff && fv) q = q.eq(ff, fv)
    const { data, error } = await q
    if (error) return 'I couldn’t run that analysis.'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data || []) as any[]
    const filterNote = ff && fv ? ` where ${ff}=${fv}` : ''

    if (metric === 'avg_call_duration') {
      const calls = rows.filter((r) => r.channel === 'voice' && typeof r.duration_seconds === 'number')
      if (!calls.length) return `No calls with a recorded duration ${range.label}.`
      const avg = Math.round(calls.reduce((a, r) => a + (r.duration_seconds || 0), 0) / calls.length)
      return `Average call duration ${range.label}: ${Math.floor(avg / 60)}m ${avg % 60}s across ${calls.length} calls.`
    }

    const total = rows.length
    if (!groupBy) return `${entity}${filterNote} ${range.label}: ${total}.`

    const keyOf = (r: Record<string, unknown>): string => {
      const tf = r[cfg.timeField] as string
      if (groupBy === 'hour') return `${String(new Date(tf).getHours()).padStart(2, '0')}:00`
      if (groupBy === 'day_of_week') return WD[new Date(tf).getDay()]
      if (groupBy === 'date') return new Date(tf).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const v = r[groupBy]
      return v == null || v === '' ? '(none)' : String(v)
    }
    const counts: Record<string, number> = {}
    for (const r of rows) { const k = keyOf(r); counts[k] = (counts[k] || 0) + 1 }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20)
    const lines = sorted.map(([k, n]) => `- ${k}: ${n} (${total ? Math.round((n / total) * 100) : 0}%)`)
    return `${entity}${filterNote} by ${groupBy}, ${range.label} (total ${total}):\n${lines.join('\n')}`
  },
}

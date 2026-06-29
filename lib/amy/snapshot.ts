import type { SourceContext } from './types'
import { relAgo } from './types'
import { parseRange } from './time'

// ── Layer 2: Rolling Business Snapshot ──────────────────────────────────────────
// Amy's live, tenant-scoped understanding of the business "right now", aggregated from
// existing tables (no new schema). Cached briefly per tenant so common daily questions
// answer instantly without scanning the database from scratch. Deep/historical questions
// bypass this and hit Layer 3 (the analyze/search tools).

export interface BusinessSnapshot { generatedAt: string; text: string }

const TTL_MS = 60_000
const cache = new Map<string, { at: number; snap: BusinessSnapshot }>()

const STOP = new Set(
  ('the a an and or but if then so to of in on at for with without from by as is are was were be been being have has had do does did will would can could should may might must i you he she it we they me him her us them my your his its our their this that these those what when where who why how not no yes ok okay just like get got want need know think really very much many more most some any all about into out up down please thanks thank hi hello hey yeah yep nope im ive id ill dont cant wont thats whats hows your youre were here there now today call called calling text texted message')
    .split(' '),
)

export async function getBusinessSnapshot(ctx: SourceContext): Promise<BusinessSnapshot> {
  const hit = cache.get(ctx.tenantId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.snap
  const snap = await build(ctx)
  cache.set(ctx.tenantId, { at: Date.now(), snap })
  return snap
}

async function build(ctx: SourceContext): Promise<BusinessSnapshot> {
  const t = ctx.tenantId
  const today = parseRange('today').start!
  const week = parseRange('this_week').start!
  const head = { count: 'exact' as const, head: true }

  const evCount = (channel: string, start: string) =>
    ctx.db.from('analytics_events').select('*', head).eq('tenant_id', t).eq('event_type', 'message_handled').eq('data->>channel', channel).gte('created_at', start)
  const convCount = (start: string) => ctx.db.from('conversations').select('*', head).eq('tenant_id', t).gte('created_at', start)
  const apptBooked = (start: string) => ctx.db.from('appointments').select('*', head).eq('tenant_id', t).neq('status', 'cancelled').gte('created_at', start)
  const apptCancelled = (start: string) => ctx.db.from('appointments').select('*', head).eq('tenant_id', t).eq('status', 'cancelled').gte('created_at', start)
  const leadCount = (start: string) => ctx.db.from('leads').select('*', head).eq('tenant_id', t).gte('created_at', start)

  const [callsToday, callsWeek, convToday, convWeek, apptToday, cancelWeek, leadsToday, leadsWeek, followRes, chanRes, msgRes] = await Promise.all([
    evCount('voice', today), evCount('voice', week),
    convCount(today), convCount(week),
    apptBooked(today), apptCancelled(week),
    leadCount(today), leadCount(week),
    ctx.db.from('leads').select('name, phone, source, created_at').eq('tenant_id', t).in('status', ['new', 'contacted']).is('responded_at', null).order('created_at', { ascending: true }).limit(20),
    ctx.db.from('conversations').select('channel').eq('tenant_id', t).gte('created_at', week).limit(2000),
    ctx.db.from('messages').select('content, conversation:conversations!inner(tenant_id)').eq('conversation.tenant_id', t).eq('role', 'user').gte('timestamp', week).limit(800),
  ])

  const follows = followRes.data || []
  const oldest = follows[0]
  const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')

  const chCounts: Record<string, number> = {}
  for (const r of chanRes.data || []) chCounts[r.channel] = (chCounts[r.channel] || 0) + 1
  const chLine = Object.entries(chCounts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} ${c}`).join(', ')

  const freq: Record<string, number> = {}
  for (const m of msgRes.data || []) {
    const words = String((m as { content?: string }).content || '').toLowerCase().match(/[a-z']{4,}/g) || []
    for (const w of new Set<string>(words)) if (!STOP.has(w)) freq[w] = (freq[w] || 0) + 1 // count once per message
  }
  const topics = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, n]) => `${w} (${n})`).join(', ')

  const rec = follows.length
    ? `Focus on follow-up — ${follows.length} warm lead${follows.length > 1 ? 's' : ''} waiting${oldest ? `, oldest since ${day(oldest.created_at)}` : ''}. Calling them is the fastest path to new appointments.`
    : (apptToday.count ? 'Appointments are booking today — keep an eye on the schedule.' : 'Nothing urgent — your AI has every channel covered.')

  const text = [
    `LIVE BUSINESS STATE (auto-maintained for THIS business, as of ${new Date().toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}):`,
    `TODAY: ${convToday.count || 0} conversations · ${callsToday.count || 0} calls answered · ${apptToday.count || 0} appointments booked · ${leadsToday.count || 0} new leads.`,
    `THIS WEEK: ${convWeek.count || 0} conversations · ${callsWeek.count || 0} calls · ${cancelWeek.count || 0} cancellations · ${leadsWeek.count || 0} new leads.`,
    `FOLLOW-UPS WAITING: ${follows.length}${oldest ? ` (oldest: ${oldest.name || oldest.phone} via ${oldest.source}, since ${day(oldest.created_at)})` : ''}.`,
    follows.length ? follows.slice(0, 6).map((l) => `  • ${l.name || l.phone} — ${l.source}, ${relAgo(l.created_at)}`).join('\n') : '',
    `CHANNELS (this week): ${chLine || 'none yet'}.`,
    `TOP TOPICS (this week, from customers' own words): ${topics || 'none yet'}.`,
    `RECOMMENDED FOCUS: ${rec}`,
  ].filter(Boolean).join('\n')

  return { generatedAt: new Date().toISOString(), text }
}

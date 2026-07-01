import type { AgentCtx } from '@/lib/playbook/data'

// ── Intelligence pulse ───────────────────────────────────────────────────────────
// READ-ONLY snapshot of REAL data for the intelligence bar: real head counts + real
// connection/scan state. No LLM, no writes, and it does NOT touch how the AI learns —
// it only reports what already exists.

export interface PulseSource { key: string; label: string; status: 'complete' | 'learning' | 'connected' | 'waiting' | 'not_connected'; count: number | null; countLabel: string }
export interface Pulse {
  percent: number
  counts: { conversations: number; messages: number; contacts: number }
  website: { scanned: boolean; items: number; url: string | null }
  sources: PulseSource[]
  connectedCount: number
}

export async function buildPulse(ctx: AgentCtx): Promise<Pulse> {
  const { admin, agent, tenantId } = ctx
  const agentId = agent.id as string
  const head = { count: 'exact' as const, head: true }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (t: string, b?: (q: any) => any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = admin.from(t).select('*', head).eq('tenant_id', tenantId)
    if (b) q = b(q)
    return q.then((r: { count: number | null }) => r.count || 0)
  }

  const [conversations, messages, contacts, voice, sms, emailC, igC, fbC, waC, emailAccts, calendars, channels] = await Promise.all([
    c('conversations'), c('messages'), c('contacts'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c('conversations', (q: any) => q.eq('channel', 'voice')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c('conversations', (q: any) => q.eq('channel', 'sms')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c('conversations', (q: any) => q.eq('channel', 'email')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c('conversations', (q: any) => q.eq('channel', 'instagram')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c('conversations', (q: any) => q.eq('channel', 'facebook')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c('conversations', (q: any) => q.eq('channel', 'whatsapp')),
    admin.from('connected_email_accounts').select('id', head).eq('tenant_id', tenantId).or(`ai_employee_id.eq.${agentId},ai_employee_id.is.null`).then((r) => r.count || 0),
    admin.from('connected_calendars').select('id', head).eq('tenant_id', tenantId).then((r) => r.count || 0),
    admin.from('channels').select('type').eq('tenant_id', tenantId).then((r) => r.data || []),
  ])
  const chTypes = new Set((channels as { type: string }[]).map((x) => x.type))
  const n = (v: number) => v.toLocaleString('en-US')

  const scanned = !!agent.website_scanned_at
  const items = agent.website_kb_item_count || 0

  const src = (key: string, label: string, status: PulseSource['status'], count: number | null, countLabel: string): PulseSource => ({ key, label, status, count, countLabel })
  const sources: PulseSource[] = [
    scanned ? src('website', 'Website', 'complete', items, `${items} items extracted`) : src('website', 'Website', 'not_connected', null, ''),
    emailAccts ? src('email', 'Email', emailC ? 'learning' : 'connected', emailC, emailC ? `${n(emailC)} email conversations` : 'Connected') : src('email', 'Email', 'not_connected', null, ''),
    chTypes.has('voice') ? src('phone', 'Phone', voice ? 'complete' : 'waiting', voice, voice ? `${n(voice)} calls analyzed` : 'Waiting for calls') : src('phone', 'Phone', 'not_connected', null, ''),
    chTypes.has('sms') ? src('sms', 'SMS', sms ? 'complete' : 'waiting', sms, sms ? `${n(sms)} text conversations` : 'Waiting for texts') : src('sms', 'SMS', 'not_connected', null, ''),
    calendars ? src('calendar', 'Calendar', 'connected', null, 'Connected') : src('calendar', 'Calendar', 'not_connected', null, ''),
    (chTypes.has('facebook') || chTypes.has('instagram')) ? src('social', 'Social', (igC + fbC) ? 'learning' : 'connected', igC + fbC, (igC + fbC) ? `${n(igC + fbC)} social conversations` : 'Connected') : src('social', 'Social', 'not_connected', null, ''),
    chTypes.has('whatsapp') ? src('whatsapp', 'WhatsApp', waC ? 'learning' : 'connected', waC, waC ? `${n(waC)} conversations` : 'Connected') : src('whatsapp', 'WhatsApp', 'not_connected', null, ''),
    src('gbp', 'Google Business', 'not_connected', null, ''),
  ]

  const total = sources.length
  const connectedCount = sources.filter((s) => s.status !== 'not_connected').length
  const percent = Math.round((connectedCount / total) * 60 + Math.min(1, conversations / 120) * 40)

  return { percent, counts: { conversations, messages, contacts }, website: { scanned, items, url: agent.website_scanned_url || agent.website || null }, sources, connectedCount }
}

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Brain view loader ────────────────────────────────────────────────────────────
// One place that assembles everything the Business Brain UI + the briefing need. Used by
// the read route AND the (cost-cached) briefing route so the spoken text always matches the
// page. Read-only; deterministic.

export interface FinancialVisibility { percent: number; connected: string[]; missing: string[]; note: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export interface BrainView {
  dna: Row[]
  understandings: Row[]
  recommendations: Row[]
  patterns: Row[]
  updates: Row[]
  sources: { total: number; voice: number; sms: number; email: number; facebook: number; instagram: number; whatsapp: number }
  dnaWeekDelta: Record<string, number>
  lastLearned: string | null
  financialVisibility: FinancialVisibility
  learnedCount: number
}

export async function loadBrainView(admin: SupabaseClient, tenantId: string, agentId: string): Promise<BrainView> {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()
  const head = { count: 'exact' as const, head: true }
  const [dnaRes, uRes, rRes, pRes, updRes, convRes, weekRes, tenantRes, payRes, calRes, leadRes] = await Promise.all([
    admin.from('business_dna').select('dna_strand, strength, evidence_count, last_updated_at').eq('tenant_id', tenantId).eq('ai_employee_id', agentId),
    admin.from('business_understanding').select('id, dna_strand, understanding_key, title, statement, business_confidence, evidence_strength, evidence_summary, last_seen_at').eq('tenant_id', tenantId).eq('ai_employee_id', agentId).order('business_confidence', { ascending: false }),
    admin.from('business_recommendations').select('id, understanding_id, category, title, why, how, if_ignored, estimated_impact, business_confidence, evidence_strength, status').eq('tenant_id', tenantId).eq('ai_employee_id', agentId).neq('status', 'dismissed').order('business_confidence', { ascending: false }),
    admin.from('business_patterns').select('category, pattern_key, title, description, metric_value, metric_unit, evidence_count').eq('tenant_id', tenantId).eq('ai_employee_id', agentId),
    admin.from('brain_updates').select('kind, dna_strand, title, detail, delta, created_at').eq('tenant_id', tenantId).eq('ai_employee_id', agentId).order('created_at', { ascending: false }).limit(12),
    admin.from('conversations').select('channel').eq('tenant_id', tenantId).limit(5000),
    admin.from('brain_updates').select('dna_strand, delta').eq('tenant_id', tenantId).eq('ai_employee_id', agentId).eq('kind', 'dna_up').gte('created_at', weekAgo),
    admin.from('tenants').select('stripe_connect_status').eq('id', tenantId).maybeSingle(),
    (async () => { try { return (await admin.from('payments').select('id', head).eq('tenant_id', tenantId)).count || 0 } catch { return 0 } })(),
    (async () => { try { return (await admin.from('connected_calendars').select('id', head).eq('tenant_id', tenantId)).count || 0 } catch { return 0 } })(),
    (async () => { try { return (await admin.from('leads').select('id', head).eq('tenant_id', tenantId)).count || 0 } catch { return 0 } })(),
  ])

  const dna = dnaRes.data || []
  const understandings = uRes.data || []
  const patterns = pRes.data || []

  const chCount: Record<string, number> = {}
  for (const c of convRes.data || []) chCount[(c.channel as string) || 'other'] = (chCount[(c.channel as string) || 'other'] || 0) + 1
  const sources = {
    total: (convRes.data || []).length,
    voice: chCount.voice || 0, sms: chCount.sms || 0, email: chCount.email || 0,
    facebook: chCount.facebook || 0, instagram: chCount.instagram || 0, whatsapp: chCount.whatsapp || 0,
  }

  const dnaWeekDelta: Record<string, number> = {}
  for (const w of weekRes.data || []) dnaWeekDelta[w.dna_strand as string] = (dnaWeekDelta[w.dna_strand as string] || 0) + (Number(w.delta) || 0)
  const lastLearned = dna.map((d: Row) => d.last_updated_at as string).sort().pop() || null

  // Financial Visibility — how much of MONEY the Brain can actually see (never fake revenue).
  const stripeConnected = tenantRes.data?.stripe_connect_status === 'connected'
  const fv = [
    { key: 'Conversations', on: sources.total > 0, w: 12 },
    { key: 'Phone calls', on: sources.voice > 0, w: 4 },
    { key: 'SMS', on: sources.sms > 0, w: 4 },
    { key: 'Stripe payments', on: stripeConnected, w: 30 },
    { key: 'Payment history', on: (payRes as number) > 0, w: 15 },
    { key: 'Calendar', on: (calRes as number) > 0, w: 15 },
    { key: 'Estimates / leads', on: (leadRes as number) > 0, w: 10 },
    { key: 'CRM', on: false, w: 10 },
  ]
  const percent = Math.min(100, fv.filter((x) => x.on).reduce((a, x) => a + x.w, 0))
  const financialVisibility: FinancialVisibility = {
    percent,
    connected: fv.filter((x) => x.on).map((x) => x.key),
    missing: fv.filter((x) => !x.on).map((x) => x.key),
    note: percent < 40 ? "I can see demand, but I can't fully prove revenue impact yet." : percent < 75 ? 'I can see demand and some revenue — connect the rest to prove impact.' : 'I can see your demand and your revenue clearly.',
  }

  return {
    dna, understandings, recommendations: rRes.data || [], patterns, updates: updRes.data || [],
    sources, dnaWeekDelta, lastLearned, financialVisibility, learnedCount: understandings.length + patterns.length,
  }
}

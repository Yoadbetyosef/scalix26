import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrainData, BrainMsg, BrainConv } from './types'
import { DNA_STRANDS } from './types'
import { detectPatterns } from './patterns'
import { deriveUnderstanding } from './understanding'
import { deriveRecommendations } from './recommendations'

const WINDOW_WEEKS = 26

export interface BrainRunResult {
  patterns: number
  understandings: number
  recommendations: number
  dna: { strand: string; strength: number }[]
  scanned: { conversations: number; messages: number; leads: number; appointments: number; payments: number }
}

// Load once, tenant-scoped + windowed. Resilient — a missing/empty source yields [].
async function loadData(admin: SupabaseClient, tenantId: string, agentId: string): Promise<BrainData> {
  const now = Date.now()
  const since = new Date(now - WINDOW_WEEKS * 7 * 864e5).toISOString()
  const safe = async <T>(p: Promise<{ data: T[] | null }>): Promise<T[]> => { try { return (await p).data || [] } catch { return [] } }

  let convQ = admin.from('conversations').select('id, channel, human_takeover, sentiment, status, created_at, contact_id')
    .eq('tenant_id', tenantId).gte('created_at', since).order('created_at', { ascending: false }).limit(2000)
  convQ = convQ.or(`ai_employee_id.eq.${agentId},ai_employee_id.is.null`)
  const conversations = await safe<BrainConv>(convQ as unknown as Promise<{ data: BrainConv[] | null }>)
  const convIds = conversations.map((c) => c.id)

  const rawMsgs = convIds.length
    ? await safe<BrainMsg & { conversation_id: string }>(
        admin.from('messages').select('conversation_id, role, content, timestamp').in('conversation_id', convIds).order('timestamp', { ascending: true }).limit(20000) as unknown as Promise<{ data: (BrainMsg & { conversation_id: string })[] | null }>,
      )
    : []
  const messagesByConv = new Map<string, BrainMsg[]>()
  for (const m of rawMsgs) {
    const arr = messagesByConv.get(m.conversation_id) || []
    arr.push({ role: m.role, content: String(m.content || ''), timestamp: m.timestamp })
    messagesByConv.set(m.conversation_id, arr)
  }

  const [tenantRow, leads, appointments, payments, paymentRequests] = await Promise.all([
    (async () => { try { return (await admin.from('tenants').select('stripe_connect_status').eq('id', tenantId).maybeSingle()).data } catch { return null } })(),
    safe(admin.from('leads').select('status, source, created_at, responded_at').eq('tenant_id', tenantId).gte('created_at', since).limit(2000) as never),
    safe(admin.from('appointments').select('status, channel, created_at, contact_id').eq('tenant_id', tenantId).gte('created_at', since).limit(2000) as never),
    safe(admin.from('payments').select('status, amount, product_name, created_at').eq('tenant_id', tenantId).gte('created_at', since).limit(2000) as never),
    safe(admin.from('payment_requests').select('status, amount, created_at, conversation_id').eq('tenant_id', tenantId).gte('created_at', since).limit(2000) as never),
  ])

  return { now, tenant: (tenantRow as Record<string, unknown>) || {}, conversations, messagesByConv, leads: leads as BrainData['leads'], appointments: appointments as BrainData['appointments'], payments: payments as BrainData['payments'], paymentRequests: paymentRequests as BrainData['paymentRequests'] }
}

// Full Phase 1 run: data → patterns → understanding → recommendations → DNA. Idempotent:
// re-running updates existing rows (preserving first_seen_at + recommendation status), never
// duplicates. Deterministic — no LLM.
export async function runBrain(admin: SupabaseClient, tenantId: string, agentId: string): Promise<BrainRunResult> {
  const data = await loadData(admin, tenantId, agentId)
  const nowIso = new Date().toISOString()

  // 1) Patterns
  const patterns = detectPatterns(data)
  const { data: exP } = await admin.from('business_patterns').select('pattern_key, first_seen_at').eq('tenant_id', tenantId).eq('ai_employee_id', agentId)
  const firstSeenP = new Map((exP || []).map((r) => [r.pattern_key as string, r.first_seen_at as string]))
  const patternIdByKey = new Map<string, string>()
  if (patterns.length) {
    const rows = patterns.map((p) => ({
      tenant_id: tenantId, ai_employee_id: agentId, category: p.category, pattern_key: p.pattern_key,
      title: p.title, description: p.description, metric_value: p.metric_value, metric_unit: p.metric_unit,
      evidence_count: p.evidence_count, evidence_refs: p.evidence_refs,
      first_seen_at: firstSeenP.get(p.pattern_key) ?? nowIso, last_seen_at: nowIso, updated_at: nowIso,
    }))
    const { data: up } = await admin.from('business_patterns').upsert(rows, { onConflict: 'tenant_id,ai_employee_id,pattern_key' }).select('id, pattern_key')
    for (const r of up || []) patternIdByKey.set(r.pattern_key as string, r.id as string)
  }

  // 2) Understanding
  const understandings = deriveUnderstanding(patterns)
  const { data: exU } = await admin.from('business_understanding').select('understanding_key, first_seen_at').eq('tenant_id', tenantId).eq('ai_employee_id', agentId)
  const firstSeenU = new Map((exU || []).map((r) => [r.understanding_key as string, r.first_seen_at as string]))
  const uIdByKey = new Map<string, string>()
  if (understandings.length) {
    const rows = understandings.map((u) => ({
      tenant_id: tenantId, ai_employee_id: agentId, dna_strand: u.dna_strand, understanding_key: u.understanding_key,
      title: u.title, statement: u.statement,
      source_pattern_ids: u.source_pattern_keys.map((k) => patternIdByKey.get(k)).filter(Boolean),
      business_confidence: u.business_confidence, evidence_strength: u.evidence_strength, evidence_summary: u.evidence_summary,
      status: 'active', first_seen_at: firstSeenU.get(u.understanding_key) ?? nowIso, last_seen_at: nowIso, updated_at: nowIso,
    }))
    const { data: up } = await admin.from('business_understanding').upsert(rows, { onConflict: 'tenant_id,ai_employee_id,understanding_key' }).select('id, understanding_key')
    for (const r of up || []) uIdByKey.set(r.understanding_key as string, r.id as string)
  }

  // 3) Recommendations (linked to understanding; preserve owner-set status)
  const recs = deriveRecommendations(understandings)
  const uids = recs.map((r) => uIdByKey.get(r.understanding_key)).filter(Boolean) as string[]
  const { data: exR } = uids.length ? await admin.from('business_recommendations').select('understanding_id, status, created_at').in('understanding_id', uids) : { data: [] }
  const prevR = new Map((exR || []).map((r) => [r.understanding_id as string, r]))
  let recCount = 0
  const rRows = recs.map((r) => {
    const uid = uIdByKey.get(r.understanding_key)
    if (!uid) return null
    const prev = prevR.get(uid) as { status?: string; created_at?: string } | undefined
    return {
      tenant_id: tenantId, ai_employee_id: agentId, understanding_id: uid, category: r.category, title: r.title,
      why: r.why, how: r.how, if_ignored: r.if_ignored, estimated_impact: r.estimated_impact,
      business_confidence: r.business_confidence, evidence_strength: r.evidence_strength,
      status: prev?.status ?? 'new', created_at: prev?.created_at ?? nowIso, updated_at: nowIso,
    }
  }).filter((x): x is NonNullable<typeof x> => x !== null)
  if (rRows.length) { await admin.from('business_recommendations').upsert(rRows, { onConflict: 'understanding_id' }); recCount = rRows.length }

  // 4) DNA rollups
  const dna = DNA_STRANDS.map((strand) => {
    const us = understandings.filter((u) => u.dna_strand === strand)
    const strength = us.length ? Math.round(us.reduce((a, u) => a + u.business_confidence, 0) / us.length) : 0
    const evidence = us.reduce((a, u) => a + u.source_pattern_keys.reduce((s, k) => s + (patterns.find((p) => p.pattern_key === k)?.evidence_count || 0), 0), 0)
    return { tenant_id: tenantId, ai_employee_id: agentId, dna_strand: strand, strength, evidence_count: evidence, last_updated_at: nowIso }
  })
  await admin.from('business_dna').upsert(dna, { onConflict: 'tenant_id,ai_employee_id,dna_strand' })

  return {
    patterns: patterns.length, understandings: understandings.length, recommendations: recCount,
    dna: dna.map((d) => ({ strand: d.dna_strand, strength: d.strength })),
    scanned: { conversations: data.conversations.length, messages: [...data.messagesByConv.values()].reduce((a, m) => a + m.length, 0), leads: data.leads.length, appointments: data.appointments.length, payments: data.payments.length },
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessSignal, BehaviorHypothesis, LearningReport } from './types'
import { harvestTenant } from './harvest'
import { perceive } from './perceive'
import { distill } from './distill'

const FIRST_RUN_LOOKBACK_DAYS = 90

interface RunOpts {
  admin: SupabaseClient
  tenantId: string
  agentId?: string | null
  persist?: boolean // false = dry run (no writes, no migration needed)
}

// Orchestrates one learning pass for ONE tenant: observe → perceive (signals) → distill
// (hypotheses) → propose (suggestions). Idempotent + incremental via a watermark cursor.
// Production-safe: in dry mode it writes nothing; in persist mode missing tables are
// reported, never thrown — so it can never break the app.
export async function runLearning({ admin, tenantId, agentId = null, persist = false }: RunOpts): Promise<LearningReport> {
  const notes: string[] = []
  const until = new Date().toISOString()

  const { data: tenant } = await admin.from('tenants').select('business_name').eq('id', tenantId).single()
  const tenantName = tenant?.business_name || 'Unknown business'

  // Resolve an agent if not given (prefer an active one).
  if (!agentId) {
    const { data: agents } = await admin
      .from('ai_employees').select('id, status').eq('tenant_id', tenantId).order('created_at', { ascending: true })
    agentId = (agents || []).find((a) => a.status === 'active')?.id || (agents || [])[0]?.id || null
  }

  // Incremental watermark (persist mode only). Dry runs always look back a fixed window.
  let since: string | null = null
  if (persist) {
    const { data: cursor } = await admin
      .from('learning_cursors').select('last_processed_at').eq('tenant_id', tenantId).eq('source', 'conversations').maybeSingle()
    since = cursor?.last_processed_at || new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 864e5).toISOString()
  } else {
    since = new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 864e5).toISOString()
  }

  const harvest = await harvestTenant(admin, tenantId, { agentId, since })
  const signals = await perceive(harvest, tenantId, agentId)
  const hypotheses = await distill(signals)
  const suggestions = hypotheses.filter((h) => h.show_to_owner)

  const signalsByType: Record<string, number> = {}
  for (const s of signals) signalsByType[s.type] = (signalsByType[s.type] || 0) + 1

  let persisted = false
  if (persist) {
    persisted = await persistAll(admin, tenantId, agentId, signals, hypotheses, suggestions, until, notes)
  }

  return {
    tenantId,
    tenantName,
    agentId,
    window: { since, until },
    sources: harvest.sources,
    counts: { ...harvest.counts, signals: signals.length, signalsByType },
    hypotheses,
    suggestions,
    persisted,
    notes,
  }
}

async function persistAll(
  admin: SupabaseClient,
  tenantId: string,
  agentId: string | null,
  signals: BusinessSignal[],
  hypotheses: BehaviorHypothesis[],
  suggestions: BehaviorHypothesis[],
  until: string,
  notes: string[],
): Promise<boolean> {
  // 1. Append signals (append-only ledger).
  if (signals.length) {
    const { error } = await admin.from('business_signals').insert(signals)
    if (error) { notes.push(`business_signals not written (${error.message}). Run add_business_signals.sql.`); return false }
  }

  // 2. Snapshot the current behavior hypotheses (replace this tenant/agent's set).
  let hb = admin.from('behavior_hypotheses').delete().eq('tenant_id', tenantId)
  hb = agentId ? hb.eq('ai_employee_id', agentId) : hb.is('ai_employee_id', null)
  const { error: delErr } = await hb
  if (delErr) { notes.push(`behavior_hypotheses not written (${delErr.message}). Run add_behavior_hypotheses.sql.`); return false }
  if (hypotheses.length) {
    await admin.from('behavior_hypotheses').insert(
      hypotheses.map((h) => ({
        tenant_id: tenantId, ai_employee_id: agentId, dimension: h.dimension, facet: h.facet, statement: h.statement,
        evidence_count: h.evidence_count, consistency: h.consistency, confidence: h.confidence,
        tier: h.tier, gold: h.gold, channels: h.channels, examples: h.examples, outcome_note: h.outcome_note || null,
        proposed: h.proposed, show_to_owner: h.show_to_owner, updated_at: until,
      })),
    )
  }

  // 3. Surface threshold-crossing hypotheses to the owner via the existing review queue,
  //    de-duped against pending ones (so daily runs don't spam).
  if (suggestions.length) {
    const { data: pending } = await admin
      .from('playbook_suggestions').select('observation').eq('tenant_id', tenantId).eq('status', 'pending')
    const seen = new Set((pending || []).map((p) => (p.observation || '').toLowerCase().slice(0, 80)))
    const rows = suggestions
      .filter((h) => !seen.has(h.statement.toLowerCase().slice(0, 80)))
      .map((h) => ({
        tenant_id: tenantId, ai_employee_id: agentId, section: h.dimension, observation: h.phrasing,
        evidence: { count: h.evidence_count, consistency: h.consistency, tier: h.tier, gold: h.gold, facet: h.facet, examples: h.examples },
        proposed: h.proposed, channels: h.channels, confidence: h.confidence, status: 'pending',
      }))
    if (rows.length) {
      const { error } = await admin.from('playbook_suggestions').insert(rows)
      if (error) notes.push(`playbook_suggestions not written (${error.message}).`)
    }
  }

  // 4. Advance the watermark.
  const { error: curErr } = await admin
    .from('learning_cursors')
    .upsert({ tenant_id: tenantId, source: 'conversations', last_processed_at: until }, { onConflict: 'tenant_id,source' })
  if (curErr) notes.push(`learning_cursors not advanced (${curErr.message}). Run add_learning_cursors.sql.`)

  return true
}

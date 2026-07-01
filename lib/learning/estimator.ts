import type { SupabaseClient } from '@supabase/supabase-js'
import { LEARNING } from './config'
import { estimateCost } from './cost'
import { historyFloorISO } from './config'

// ── Pre-flight import estimator (admin only) ─────────────────────────────────────
// Cheap deterministic head-counts per source → run the reduction MODEL → price it. This
// is what powers the "Business Learning Estimate" the admin sees before an import starts.
// It never calls an LLM; it predicts what the import will cost. Conservative by design.

export interface SourceCount { key: string; label: string; records: number }
export interface ImportEstimate {
  sources: SourceCount[]
  totalRecords: number
  expectedRepresentatives: number // how many examples will actually reach the LLM
  estimatedTokens: number
  estimatedCostUSD: number
  estimatedDurationMs: number
}

// Deterministic reduction: after dedupe+cluster+sample, only a sublinear number of
// representative examples reach the model. ~15% of volume, hard-capped by the sample size.
const PATTERN_RATIO = 0.15
function expectedReps(records: number): number {
  if (records <= 0) return 0
  return Math.min(LEARNING.SAMPLE.initial, Math.max(1, Math.ceil(records * PATTERN_RATIO)))
}

// Per-representative token budget for the Haiku classification pass, and a bounded Sonnet
// synthesis pass for the final business understanding.
const TOK_CLASSIFY_IN = 600
const TOK_CLASSIFY_OUT = 200
const TOK_SYNTH_IN_PER_REP = 150
const TOK_SYNTH_OUT = 2500
const MS_PER_CALL = 3500

export async function estimateImport(admin: SupabaseClient, tenantId: string, agentId: string | null): Promise<ImportEstimate> {
  const head = { count: 'exact' as const, head: true }
  const floor = historyFloorISO()
  const convByChannel = (ch: string) => admin.from('conversations').select('*', head)
    .eq('tenant_id', tenantId).eq('channel', ch).gte('created_at', floor).then((r) => r.count || 0)

  let websiteQ = admin.from('knowledge_base').select('*', head).eq('tenant_id', tenantId).eq('source', 'website')
  if (agentId) websiteQ = websiteQ.or(`ai_employee_id.eq.${agentId},ai_employee_id.is.null`)

  const [website, email, sms, voice, instagram, facebook, whatsapp] = await Promise.all([
    websiteQ.then((r) => r.count || 0),
    convByChannel('email'), convByChannel('sms'), convByChannel('voice'),
    convByChannel('instagram'), convByChannel('facebook'), convByChannel('whatsapp'),
  ])

  const sources: SourceCount[] = [
    { key: 'website', label: 'Website', records: website },
    { key: 'email', label: 'Email', records: email },
    { key: 'sms', label: 'SMS', records: sms },
    { key: 'voice', label: 'Calls', records: voice },
    { key: 'instagram', label: 'Instagram', records: instagram },
    { key: 'facebook', label: 'Facebook', records: facebook },
    { key: 'whatsapp', label: 'WhatsApp', records: whatsapp },
  ].filter((s) => s.records > 0)

  const totalRecords = sources.reduce((a, s) => a + s.records, 0)
  const reps = sources.reduce((a, s) => a + expectedReps(s.records), 0)

  const classifyIn = reps * TOK_CLASSIFY_IN
  const classifyOut = reps * TOK_CLASSIFY_OUT
  const synthIn = reps * TOK_SYNTH_IN_PER_REP + 2000
  const synthOut = TOK_SYNTH_OUT
  const estimatedTokens = classifyIn + classifyOut + synthIn + synthOut

  const estimatedCostUSD =
    estimateCost('claude-haiku-4-5', classifyIn, classifyOut) +
    estimateCost('claude-sonnet-4-6', synthIn, synthOut)

  const calls = Math.ceil(reps / LEARNING.CHUNK) + 1 // classification batches + final synthesis
  const estimatedDurationMs = calls * MS_PER_CALL

  return {
    sources,
    totalRecords,
    expectedRepresentatives: reps,
    estimatedTokens,
    estimatedCostUSD: Number(estimatedCostUSD.toFixed(4)),
    estimatedDurationMs,
  }
}

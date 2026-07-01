import { type OwnerPlaybook, PLAYBOOK_SECTIONS, normalizePlaybook } from './types'
import { approvePlaybook, saveDraftPlaybook } from './apply'
import type { AgentCtx } from './data'
import { callModel } from '@/lib/learning/llm'
import { LearningBudget, BUDGET_PAUSED_MESSAGE, initialImportDone } from '@/lib/learning/budget'
import { LEARNING, historyFloorISO, jobCap, sampleSize } from '@/lib/learning/config'
import { selectConversations, type ConvLike, type Representative } from '@/lib/learning/select'
import { unseenHashes, markSeen } from '@/lib/learning/dedupe'
import { estimateImport } from '@/lib/learning/estimator'
import { planLearningJob } from '@/lib/learning/planner'
import { loadMemory, reinforceMatches, insertNovel, newEntry } from '@/lib/learning/memory'

const SECTION_KEYS = PLAYBOOK_SECTIONS.map((s) => s.key)

interface RawSuggestion {
  section: string
  observation: string
  proposed: { text?: string; customer?: string; reply?: string }
  channels?: string[]
  confidence?: number
}

const SOURCE = 'conversations'

/**
 * Learn playbook improvements from THIS business's REAL conversations — as a cost-capped
 * JOB. Two phases (never a calendar budget):
 *   • initial     — one-time deep pass over history (cap $5), runs the pre-flight estimate.
 *   • incremental — only NEW conversations since the watermark (cap $0.10), tiny + quiet.
 * Deterministic cluster+dedupe+sample happens BEFORE any LLM, and repeated questions
 * collapse into a single frequency-weighted event. Review-queue only; never auto-applies.
 */
export async function scanForSuggestions(ctx: AgentCtx): Promise<{ added: number; paused?: boolean; message?: string; phase?: string; cost?: number }> {
  const { admin, agent, tenantId } = ctx

  // Phase: first ever run for this tenant → the one-time initial import; otherwise incremental.
  const phase = (await initialImportDone(admin, tenantId, SOURCE)) ? 'incremental' : 'initial'
  const isInitial = phase === 'initial'
  const preflight = isInitial
    ? await (async () => { const e = await estimateImport(admin, tenantId, agent.id); return { tokens: e.estimatedTokens, costUSD: e.estimatedCostUSD, durationMs: e.estimatedDurationMs, breakdown: { sources: e.sources, expectedRepresentatives: e.expectedRepresentatives } } })()
    : undefined

  const budget = new LearningBudget(admin, tenantId, SOURCE, { phase, maxCostUSD: jobCap(phase), preflight })
  await budget.begin()
  if (budget.paused) { await budget.end(); return { added: 0, paused: true, message: BUDGET_PAUSED_MESSAGE, phase } }

  // Incremental starts after the watermark; initial sweeps history (capped to the floor).
  const { data: cur } = await admin
    .from('learning_cursors').select('last_processed_at').eq('tenant_id', tenantId).eq('source', SOURCE).maybeSingle()
  const watermark: string | null = cur?.last_processed_at || null

  let convQ = admin
    .from('conversations')
    .select('id, channel, human_takeover, summary, sentiment, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: !isInitial }) // incremental: oldest-new first so the watermark advances cleanly
    .limit(isInitial ? LEARNING.INITIAL_MAX_RECORDS : LEARNING.INCREMENTAL_BATCH)
  convQ = isInitial ? convQ.gte('created_at', historyFloorISO()) : convQ.gt('created_at', watermark || historyFloorISO())
  if (agent.id) convQ = convQ.or(`ai_employee_id.eq.${agent.id},ai_employee_id.is.null`)
  const { data: convs } = await convQ
  const convIds = (convs || []).map((c) => c.id)
  if (!convIds.length) {
    if (isInitial) await advanceWatermark(admin, tenantId, new Date().toISOString()) // nothing to learn, but initial is "done"
    await budget.end()
    return { added: 0, phase }
  }
  budget.scanned(convIds.length)
  const batchMaxCreated = (convs || []).reduce((mx, c) => (c.created_at > mx ? c.created_at : mx), '')

  const { data: msgs } = await admin
    .from('messages')
    .select('conversation_id, role, content, channel, timestamp')
    .in('conversation_id', convIds)
    .order('timestamp', { ascending: true })
    .limit(LEARNING.MAX_MESSAGES_PER_RUN)

  const byConv = new Map<string, { role: string; content: string }[]>()
  for (const m of msgs || []) {
    const arr = byConv.get(m.conversation_id) || []
    arr.push({ role: m.role, content: String(m.content || '').slice(0, 400) })
    byConv.set(m.conversation_id, arr)
  }

  // Cheap deterministic pass FIRST: normalize → collapse repeats → cluster → sample.
  const units: ConvLike[] = (convs || []).map((c) => ({
    id: c.id, channel: c.channel, human_takeover: c.human_takeover, sentiment: c.sentiment, messages: byConv.get(c.id) || [],
  }))
  const selection = selectConversations(units, sampleSize(phase))
  budget.deduplicated(selection.stats.deduplicated)

  // Skip conversations already learned from (content cache).
  const fresh = await unseenHashes(admin, tenantId, SOURCE, selection.hashes)
  const chosen = selection.representatives.filter((_, i) => fresh.has(selection.hashes[i]))
  const chosenHashes = selection.hashes.filter((h) => fresh.has(h))
  budget.skipped(selection.representatives.length - chosen.length)
  if (!chosen.length) {
    if (isInitial && !budget.paused) await advanceWatermark(admin, tenantId, new Date().toISOString())
    else if (!budget.paused) await advanceWatermark(admin, tenantId, batchMaxCreated || watermark)
    await budget.end()
    return { added: 0, phase }
  }
  budget.samples(chosen.length)
  void chosenHashes

  // ── Cumulative memory + planner ────────────────────────────────────────────────
  // Match the clustered patterns against what the business ALREADY knows. Known + similar
  // patterns are reinforced for FREE (no LLM). The planner then decides which NOVEL patterns
  // to synthesize now, which to route to Haiku, and which to defer — all under the job cap.
  const memory = await loadMemory(admin, tenantId, agent.id)
  const plan = planLearningJob(chosen, memory, { capUSD: jobCap(phase), phase })
  budget.known(plan.known.length); budget.similar(plan.similar.length)
  budget.novel(plan.novel.length); budget.saved(plan.costSavedUSD); budget.addNotes(plan.notes)

  // Reinforce everything already understood — cumulative, deterministic, zero tokens.
  await reinforceMatches(admin, [...plan.known, ...plan.similar])

  // Outcomes + current playbook (shared across synthesis batches).
  const { data: leads } = await admin
    .from('leads').select('status, source, created_at').eq('tenant_id', tenantId)
    .order('created_at', { ascending: false }).limit(50)
  const outcomeLine = (() => {
    const counts: Record<string, number> = {}
    for (const l of leads || []) counts[l.status] = (counts[l.status] || 0) + 1
    return Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ')
  })()
  const existing = JSON.stringify(normalizePlaybook(agent.playbook)).slice(0, 4000)

  // Synthesize ONLY the novel patterns the plan approved, batched, at the planned model tier.
  const strongReps = plan.processNow.filter((p) => p.model === 'strong').map((p) => p.rep)
  const cheapReps = plan.processNow.filter((p) => p.model === 'cheap').map((p) => p.rep)
  const allItems: RawSuggestion[] = []
  const processedReps: Representative[] = []
  outer: for (const g of [{ tier: 'strong' as const, reps: strongReps }, { tier: 'cheap' as const, reps: cheapReps }]) {
    for (let i = 0; i < g.reps.length; i += LEARNING.CHUNK) {
      if (budget.paused) break outer
      const chunk = g.reps.slice(i, i + LEARNING.CHUNK)
      const raw = (await callModel(buildPrompt(chunk, selection.statsLine, outcomeLine, existing), 1500, { budget, tier: g.tier })) || '[]'
      if (budget.paused) break outer // refused by the cap → don't count this batch
      const m = raw.match(/\[[\s\S]*\]/)
      if (m) { try { allItems.push(...(JSON.parse(m[0]) as RawSuggestion[])) } catch { /* skip */ } }
      processedReps.push(...chunk)
    }
  }

  // Record newly-understood patterns in cumulative memory so we NEVER pay to relearn them.
  if (processedReps.length) {
    await insertNovel(admin, processedReps.map((r) => newEntry(tenantId, agent.id, r, questionOf(r))))
  }

  // Whatever the planner deferred, or the cap cut off mid-run, is left for the next job.
  const unprocessed = plan.processNow.length - processedReps.length
  const deferredTotal = plan.deferred.length + Math.max(0, unprocessed)
  if (deferredTotal > 0) { budget.deferredCount(deferredTotal); budget.defer() }

  // De-dupe suggestions against the pending queue.
  const { data: pending } = await admin
    .from('playbook_suggestions').select('observation').eq('tenant_id', tenantId).eq('status', 'pending')
  const seen = new Set((pending || []).map((p) => (p.observation || '').toLowerCase().slice(0, 80)))
  const rows = allItems
    .filter((s) => s && SECTION_KEYS.includes(s.section as keyof OwnerPlaybook) && s.observation && (s.confidence ?? 0) >= 0.6)
    .filter((s) => !seen.has(s.observation.toLowerCase().slice(0, 80)))
    .slice(0, 12)
    .map((s) => ({
      tenant_id: tenantId, ai_employee_id: agent.id, section: s.section,
      observation: s.observation.slice(0, 500), evidence: {},
      proposed: s.proposed || { text: '' },
      channels: Array.isArray(s.channels) ? s.channels.slice(0, 8) : [],
      confidence: Math.max(0, Math.min(1, s.confidence ?? 0.6)), status: 'pending',
    }))

  // Persist: mark processed patterns, advance the watermark ONLY if the job finished cleanly
  // (nothing deferred / paused), then close the job (records cost + savings).
  await markSeen(admin, tenantId, SOURCE, processedReps.map((r) => r.patternHash))
  if (!budget.paused) await advanceWatermark(admin, tenantId, isInitial ? new Date().toISOString() : (batchMaxCreated || watermark))
  const metrics = await budget.end()
  const tail = { phase, cost: Number(metrics.actual_cost.toFixed(4)), ...(budget.paused ? { paused: true, message: BUDGET_PAUSED_MESSAGE } : {}) }

  if (rows.length) {
    const { error } = await admin.from('playbook_suggestions').insert(rows)
    if (error) throw new Error(error.message)
  }
  return { added: rows.length, ...tail }
}

function questionOf(rep: Representative): string {
  const u = rep.messages.find((m) => m.role === 'user')
  return (u?.content || rep.messages[0]?.content || rep.patternKey).slice(0, 300)
}

async function advanceWatermark(admin: AgentCtx['admin'], tenantId: string, at: string | null) {
  if (!at) return
  try {
    await admin.from('learning_cursors')
      .upsert({ tenant_id: tenantId, source: SOURCE, last_processed_at: at }, { onConflict: 'tenant_id,source' })
  } catch { /* best-effort */ }
}

function buildPrompt(chunk: Representative[], statsLine: string, outcomeLine: string, existing: string): string {
  const digest = chunk
    .map((c) => {
      const lines = c.messages.slice(0, 12).map((m) => `${m.role}: ${m.content}`).join('\n')
      const freq = c.frequency > 1 ? ` · seen ${c.frequency}×` : ''
      const tags = [c.channel, c.human_takeover ? 'OWNER TOOK OVER' : '', c.sentiment].filter(Boolean).join(' · ')
      return `# Conversation (${tags}${freq})\n${lines}`
    })
    .join('\n\n')
    .slice(0, 14000)

  return `You are improving an AI employee's "Owner Playbook" by learning from this business's REAL conversations. Propose concrete, high-confidence improvements ONLY — recurring questions, how pricing is handled, objections + the owner's responses, escalation moments, owner phrasing seen during takeovers, and patterns behind booked vs lost leads.
A conversation marked "seen N×" stands in for N near-identical ones — weight those more heavily.

Aggregate stats (deterministic): ${statsLine}
Lead outcomes: ${outcomeLine || 'n/a'}

CURRENT PLAYBOOK (do not repeat what's already covered):
${existing}

CONVERSATIONS:
${digest}

Return ONLY a JSON array (max 6 items). Each item:
{
  "section": one of ${JSON.stringify(SECTION_KEYS)},
  "observation": "what you noticed, 1 sentence",
  "proposed": { "text": "the rule to add" }  // for example/question sections use {"customer": "...", "reply": "..."} instead
  "channels": ["voice","sms",...],
  "confidence": 0.0-1.0
}
Only include suggestions with confidence >= 0.6. If nothing is clearly supported by the conversations, return [].`
}

/** Merge an approved suggestion into the playbook, then push it live if already approved. */
export async function approveSuggestion(ctx: AgentCtx, suggestionId: string): Promise<void> {
  const { admin, agent, tenantId } = ctx
  const { data: sug } = await admin
    .from('playbook_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .eq('tenant_id', tenantId)
    .single()
  if (!sug) throw new Error('Suggestion not found')

  const pb = normalizePlaybook(agent.playbook)
  const meta = PLAYBOOK_SECTIONS.find((s) => s.key === sug.section)
  const proposed = (sug.proposed || {}) as { text?: string; customer?: string; reply?: string }

  const slot = pb as unknown as Record<string, unknown>
  if (meta?.kind === 'examples') {
    if (proposed.customer || proposed.reply) {
      ;(slot[sug.section] as { customer: string; reply: string }[]).push({
        customer: String(proposed.customer || ''),
        reply: String(proposed.reply || ''),
      })
    }
  } else if (meta?.kind === 'list') {
    const text = String(proposed.text || proposed.reply || '').trim()
    if (text) (slot[sug.section] as string[]).push(text)
  } else if (meta?.kind === 'text') {
    const text = String(proposed.text || '').trim()
    if (text) slot[sug.section] = text
  }

  // Persist the merged playbook; if it was already live, recompile system_prompt so the
  // change takes effect immediately — otherwise just update the draft.
  if (agent.playbook_status === 'approved') await approvePlaybook(ctx, pb)
  else await saveDraftPlaybook(ctx, pb)

  await admin
    .from('playbook_suggestions')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', suggestionId)
    .eq('tenant_id', tenantId)
}

export async function rejectSuggestion(ctx: AgentCtx, suggestionId: string): Promise<void> {
  const { admin, tenantId } = ctx
  await admin
    .from('playbook_suggestions')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', suggestionId)
    .eq('tenant_id', tenantId)
}

import { anthropic } from '@/lib/anthropic/client'
import { createAdminClient } from '@/lib/supabase/server'
import { amyTools, runTool } from './registry'
import { getBusinessSnapshot } from './snapshot'
import type { SourceContext } from './types'

// Stronger model for the Chief-of-Staff text path (Haiku fallback). Realtime voice stays Haiku.
const AMY_MODEL = 'claude-sonnet-4-6'
const FALLBACK_MODEL = 'claude-haiku-4-5'

// A sentinel tool so the PLANNER can signal "I've gathered everything" — without ever
// being allowed to write prose (tool_choice is forced to 'any' during planning).
const FINISH_TOOL = {
  name: 'finish',
  description: 'Call this ONLY after you have already retrieved/computed every piece of data needed to fully answer. Do not call it before gathering the data.',
  input_schema: { type: 'object' as const, properties: {} },
}

/**
 * Amy's reasoning pipeline — planner → execute → respond.
 *
 *   1. PLANNER decides which data is needed and calls tools (forced: it can ONLY call
 *      tools, never write prose — so it can never say "I'll check…"). It may call many
 *      tools at once (executed in parallel) and across rounds.
 *   2. EXECUTE runs every tool, tenant-scoped, and merges results into the transcript.
 *   3. RESPONDER writes the final answer from the gathered data only — with NO tools
 *      available, so it is structurally incapable of promising to retrieve anything.
 *
 * The owner never sees the retrieval. If the data exists, it's already fetched before
 * a single word is written.
 */
export async function answerAsAmy(opts: {
  tenantId: string
  question: string
  employeeName?: string
  businessName?: string
}): Promise<string> {
  const ctx: SourceContext = { tenantId: opts.tenantId, db: createAdminClient() }
  const name = opts.employeeName || 'Amy'
  const biz = opts.businessName || 'this business'

  // ── Layer 2: read the live business snapshot FIRST ──────────────────────────
  // Amy's continuously-maintained memory of THIS business (today + this week). Common
  // daily questions ("what happened today?", "anything urgent?", "who needs follow-up?")
  // are answered straight from this — the planner calls `finish` with no deep search.
  // Only specific/historical questions fall through to the Layer-3 deep-search tools.
  const snapshot = await getBusinessSnapshot(ctx)

  let model = AMY_MODEL
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (params: any) => {
    try {
      return await anthropic.messages.create({ model, ...params })
    } catch (e) {
      if (model !== FALLBACK_MODEL) { model = FALLBACK_MODEL; return anthropic.messages.create({ model, ...params }) }
      throw e
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: 'user', content: opts.question }]

  // ── 1+2. PLANNER + EXECUTE — gather ALL data first (forced tool use, no prose) ──
  const plannerSystem = [
    `You are the retrieval planner for ${name}, the AI Chief of Staff for ${biz}. Your ONLY job is to gather every piece of data needed to fully answer the owner's question. You do NOT write any answer, explanation, or commentary.`,
    `You ALREADY have ${name}'s live business memory below. If the owner's question is about today, this week, current follow-ups, channels, top topics, or "anything urgent / what should I focus on", the answer is ALREADY in this snapshot — call the finish tool IMMEDIATELY with no other tool. Do NOT deep-search for things the snapshot already covers.`,
    `\n${snapshot.text}\n`,
    `Only call the deep-search tools when the question needs something NOT in the snapshot: a specific customer, a historical period (e.g. "in March", "4 months ago"), full transcripts, "find everyone who mentioned X", or a calculation/breakdown. For a historical period, pass the appropriate time_range (or from/to) to analyze/search_everything. Emit MULTIPLE tool calls at once when independent (e.g. "this week vs last week" = analyze for both periods in one step). Tools: analyze, search_everything, get_conversation_transcript, search_conversations, lookup_contact, get_appointments, get_leads, search_knowledge.`,
    `Gather thoroughly — if a question needs scanning many records, retrieve them. Only AFTER you have everything (or immediately, if the snapshot suffices), call the finish tool. Never produce prose.`,
  ].join('\n')
  const plannerTools = [...amyTools(), FINISH_TOOL]

  let deepSearches = 0 // source tracking: 0 ⇒ answered from snapshot, >0 ⇒ deep search
  for (let round = 0; round < 8; round++) {
    const res = await call({ max_tokens: 1024, system: plannerSystem, tools: plannerTools, tool_choice: { type: 'any' }, messages })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUses = (res.content as any[]).filter((b) => b.type === 'tool_use')
    if (!toolUses.length) break
    deepSearches += toolUses.filter((b) => b.name !== 'finish').length
    messages.push({ role: 'assistant', content: res.content })
    // Execute every requested tool in parallel; the owner never sees this.
    const results = await Promise.all(
      toolUses.map(async (b) => ({
        type: 'tool_result',
        tool_use_id: b.id,
        content: b.name === 'finish' ? 'Gathered.' : await runTool(ctx, b.name, (b.input || {}) as Record<string, unknown>),
      })),
    )
    messages.push({ role: 'user', content: results })
    if (toolUses.some((b) => b.name === 'finish')) break
  }

  // ── 3. RESPONDER — answer from gathered data ONLY (no tools → cannot promise) ──
  const answerSystem = [
    `You are ${name}, the AI Chief of Staff for ${biz} — an executive advisor speaking to the owner. Answer now, using your live business memory and any data already retrieved above.`,
    `Your live business memory:\n${snapshot.text}`,
    `ABSOLUTELY FORBIDDEN: "I'll check", "I'll look into", "I'll analyze", "I can compare", "let me…", "I don't know", or any promise of future action. The data is already in front of you — answer from it directly.`,
    `If the data has no records for the request, say exactly what was searched and that nothing was found (e.g. "I searched every conversation and found no one asking about catering" or, for a historical period, "I searched that period and found no matching business activity"). If something truly can't be computed because a data source isn't connected yet (e.g. revenue by service, because payments aren't connected), say which source is missing and why — never pretend, never invent.`,
    `The ONE exception to "never ask": if the question's time range is genuinely ambiguous and you could not resolve it, you may ask ONE short clarifying question instead of guessing.`,
    `Lead with the answer and the key numbers. Be concise — don't dump raw rows. When useful, finish with "Here's what I recommend…".`,
  ].join('\n')

  const final = await call({ max_tokens: 1024, system: answerSystem, messages })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (final.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  // Internal source tracking (not shown to the owner): how Amy answered this question.
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[amy] answered via ${deepSearches === 0 ? 'snapshot' : `deep_search (${deepSearches} retrieval${deepSearches > 1 ? 's' : ''})`} · model=${model}`)
  }
  return text || 'I gathered the data but couldn’t summarize it — try rephrasing the question.'
}

import { anthropic } from '@/lib/anthropic/client'
import { type OwnerPlaybook, PLAYBOOK_SECTIONS, normalizePlaybook } from './types'
import { approvePlaybook, saveDraftPlaybook } from './apply'
import type { AgentCtx } from './data'

const MODEL = 'claude-sonnet-4-6'
const FALLBACK = 'claude-haiku-4-5'

const SECTION_KEYS = PLAYBOOK_SECTIONS.map((s) => s.key)

interface RawSuggestion {
  section: string
  observation: string
  proposed: { text?: string; customer?: string; reply?: string }
  channels?: string[]
  confidence?: number
}

/**
 * Continuous learning (review queue only — never changes behavior automatically).
 * Analyze recent real activity for THIS business and propose playbook improvements:
 * recurring questions, pricing patterns, objections, escalation moments, owner phrasing
 * from human-takeovers, and lost/booked outcomes. Inserts pending suggestions for the
 * owner to approve/reject/edit. Strictly tenant-scoped.
 */
export async function scanForSuggestions(ctx: AgentCtx): Promise<{ added: number }> {
  const { admin, agent, tenantId } = ctx

  // Recent conversations for this tenant (+ this agent when set), with channel + takeover.
  let convQ = admin
    .from('conversations')
    .select('id, channel, human_takeover, summary, sentiment, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(40)
  if (agent.id) convQ = convQ.or(`ai_employee_id.eq.${agent.id},ai_employee_id.is.null`)
  const { data: convs } = await convQ
  const convIds = (convs || []).map((c) => c.id)
  if (!convIds.length) return { added: 0 }

  const { data: msgs } = await admin
    .from('messages')
    .select('conversation_id, role, content, channel, timestamp')
    .in('conversation_id', convIds)
    .order('timestamp', { ascending: true })
    .limit(400)

  const byConv = new Map<string, { role: string; content: string }[]>()
  for (const m of msgs || []) {
    const arr = byConv.get(m.conversation_id) || []
    arr.push({ role: m.role, content: String(m.content || '').slice(0, 400) })
    byConv.set(m.conversation_id, arr)
  }
  const digest = (convs || [])
    .slice(0, 25)
    .map((c) => {
      const lines = (byConv.get(c.id) || []).slice(0, 12).map((m) => `${m.role}: ${m.content}`).join('\n')
      const tags = [c.channel, c.human_takeover ? 'OWNER TOOK OVER' : '', c.sentiment].filter(Boolean).join(' · ')
      return `# Conversation (${tags})\n${lines}`
    })
    .join('\n\n')
    .slice(0, 14000)

  // Outcome signals.
  const { data: leads } = await admin
    .from('leads').select('status, source, created_at').eq('tenant_id', tenantId)
    .order('created_at', { ascending: false }).limit(50)
  const outcomeLine = (() => {
    const counts: Record<string, number> = {}
    for (const l of leads || []) counts[l.status] = (counts[l.status] || 0) + 1
    return Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ')
  })()

  const playbook = normalizePlaybook(agent.playbook)
  const existing = JSON.stringify(playbook).slice(0, 4000)

  const prompt = `You are improving an AI employee's "Owner Playbook" by learning from this business's REAL recent conversations. Propose concrete, high-confidence improvements ONLY — recurring questions, how pricing is handled, objections + the owner's responses, escalation moments, owner phrasing seen during takeovers, and patterns behind booked vs lost leads.

Lead outcomes: ${outcomeLine || 'n/a'}

CURRENT PLAYBOOK (do not repeat what's already covered):
${existing}

RECENT CONVERSATIONS:
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

  let model = MODEL
  const call = async () => {
    try {
      return await anthropic.messages.create({ model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
    } catch (e) {
      if (model !== FALLBACK) { model = FALLBACK; return anthropic.messages.create({ model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }) }
      throw e
    }
  }
  const res = await call()
  const raw = res.content[0]?.type === 'text' ? res.content[0].text : '[]'
  const match = raw.match(/\[[\s\S]*\]/)
  let items: RawSuggestion[] = []
  if (match) { try { items = JSON.parse(match[0]) as RawSuggestion[] } catch { items = [] } }

  // De-dupe against existing pending suggestions.
  const { data: pending } = await admin
    .from('playbook_suggestions')
    .select('observation')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
  const seen = new Set((pending || []).map((p) => (p.observation || '').toLowerCase().slice(0, 80)))

  const rows = items
    .filter((s) => s && SECTION_KEYS.includes(s.section as keyof OwnerPlaybook) && s.observation && (s.confidence ?? 0) >= 0.6)
    .filter((s) => !seen.has(s.observation.toLowerCase().slice(0, 80)))
    .slice(0, 6)
    .map((s) => ({
      tenant_id: tenantId,
      ai_employee_id: agent.id,
      section: s.section,
      observation: s.observation.slice(0, 500),
      evidence: {},
      proposed: s.proposed || { text: '' },
      channels: Array.isArray(s.channels) ? s.channels.slice(0, 8) : [],
      confidence: Math.max(0, Math.min(1, s.confidence ?? 0.6)),
      status: 'pending',
    }))

  if (!rows.length) return { added: 0 }
  const { error } = await admin.from('playbook_suggestions').insert(rows)
  if (error) throw new Error(error.message)
  return { added: rows.length }
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

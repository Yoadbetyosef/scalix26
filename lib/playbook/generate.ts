import { anthropic } from '@/lib/anthropic/client'
import { type OwnerPlaybook, normalizePlaybook } from './types'
import type { AgentCtx } from './data'

// Stronger model for synthesis (Haiku fallback), like the Amy text path.
const PLAYBOOK_MODEL = 'claude-sonnet-4-6'
const FALLBACK_MODEL = 'claude-haiku-4-5'

const SCHEMA_HINT = `Return ONLY valid JSON with EXACTLY these keys (no extra keys, no commentary):
{
  "business_summary": "1-3 sentences: what the business does and who it serves",
  "tone_profile": "how the AI should sound (e.g. warm, professional, concise, confident, never pushy)",
  "response_style": "length/format the owner prefers (e.g. 1-2 short sentences, no jargon)",
  "sales_style": "how hard to push toward booking (e.g. helpful first, suggest booking when there's clear intent)",
  "services_products": ["main services or products offered"],
  "pricing_rules": ["how to answer pricing — e.g. 'give ranges, never exact quotes unless approved'"],
  "booking_rules": ["when and how to book an appointment"],
  "qualification_rules": ["what makes a customer worth booking / next questions to ask"],
  "escalation_rules": ["when to stop and hand off to the owner"],
  "emergency_rules": ["how to handle urgent or after-hours requests"],
  "follow_up_rules": ["when/how to follow up"],
  "channel_rules": ["any per-channel behavior (voice vs SMS vs email vs social)"],
  "uncertainty_rules": ["what to do when unsure — the safety net, e.g. 'never guess pricing/availability; say the team will follow up'"],
  "objection_handling": ["When the customer says X, respond Y"],
  "do_say": ["things the AI should always say/offer"],
  "do_not_say": ["things the AI must never say or promise"],
  "high_value_signals": ["signs a lead is high value"],
  "low_value_signals": ["signs a lead is low value or not a fit"],
  "common_questions": [{"customer": "a frequent question", "reply": "the ideal answer"}],
  "examples": [{"customer": "a realistic customer message", "reply": "how the owner would respond"}]
}
Use [] or "" when genuinely unknown. NEVER invent pricing, availability, guarantees, or legal/medical claims.`

interface GenerateInput {
  ctx: AgentCtx
  // Optional behavioral evidence already gathered (kept small); generation works without it.
  conversationDigest?: string
}

/**
 * Synthesize a draft Owner Playbook from everything we know about the business:
 * the AI employee's identity + the owner's free-text instructions, the website-scanned
 * + manual knowledge base, the onboarding-interview answers, and (optionally) a short
 * digest of real conversations. Strictly tenant-scoped via the passed AgentCtx.
 */
export async function generatePlaybook({ ctx, conversationDigest }: GenerateInput): Promise<OwnerPlaybook> {
  const { admin, agent, tenant, tenantId } = ctx

  // Knowledge base (website scan + manual + templates), agent-scoped + tenant-wide.
  const { data: kbRows } = await admin
    .from('knowledge_base')
    .select('title, content, source')
    .eq('tenant_id', tenantId)
    .or(`ai_employee_id.eq.${agent.id},ai_employee_id.is.null`)
    .order('created_at', { ascending: true })
    .limit(60)
  const kb = (kbRows || []).map((r) => `## ${r.title} (${r.source})\n${r.content}`).join('\n\n').slice(0, 12000)

  const bizHours = (agent.business_hours || {}) as Record<string, string>
  const hoursStr = Object.entries(bizHours).map(([d, h]) => `${d}: ${h}`).join(', ')

  const answers = (agent.onboarding_answers || {}) as Record<string, string>
  const interview = Object.entries(answers)
    .filter(([, v]) => v && String(v).trim())
    .map(([q, v]) => `Q: ${q}\nOwner: ${v}`)
    .join('\n\n')
    .slice(0, 6000)

  const profile = [
    `Business: ${agent.business_name || tenant.business_name || 'Unknown'}`,
    agent.industry || tenant.industry ? `Industry: ${agent.industry || tenant.industry}` : '',
    agent.city || agent.state ? `Location: ${[agent.city, agent.state].filter(Boolean).join(', ')}` : '',
    agent.website ? `Website: ${agent.website}` : '',
    hoursStr ? `Hours: ${hoursStr}` : '',
    agent.system_prompt ? `Owner's existing instructions:\n${String(agent.system_prompt).slice(0, 2000)}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const userContent = `You are building the "Owner Playbook" — a structured profile that lets an AI employee answer phone, SMS, email, and social messages exactly the way this specific business owner would. Be faithful to the owner's real preferences; do not invent facts.

BUSINESS PROFILE:
${profile}

KNOWLEDGE BASE:
${kb || '(none provided)'}

OWNER INTERVIEW:
${interview || '(none provided)'}
${conversationDigest ? `\nOBSERVED CONVERSATIONS:\n${conversationDigest.slice(0, 6000)}` : ''}

${SCHEMA_HINT}`

  let model = PLAYBOOK_MODEL
  const call = async () => {
    try {
      return await anthropic.messages.create({ model, max_tokens: 3000, messages: [{ role: 'user', content: userContent }] })
    } catch (e) {
      if (model !== FALLBACK_MODEL) { model = FALLBACK_MODEL; return anthropic.messages.create({ model, max_tokens: 3000, messages: [{ role: 'user', content: userContent }] }) }
      throw e
    }
  }

  const res = await call()
  const raw = res.content[0]?.type === 'text' ? res.content[0].text : '{}'
  const match = raw.match(/\{[\s\S]*\}/)
  let parsed: unknown = {}
  if (match) { try { parsed = JSON.parse(match[0]) } catch { parsed = {} } }
  return normalizePlaybook(parsed)
}

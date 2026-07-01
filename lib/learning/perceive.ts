import type { BusinessSignal, InteractionUnit, SignalType } from './types'
import type { Harvest } from './harvest'
import { callModel, extractJsonArray } from './llm'
import type { LearningBudget } from './budget'

const PRICE_RE = /\b(price|pricing|cost|costs|how much|quote|estimate|charge|rate|fee|deposit|\$\s?\d)/i
const RANGE_RE = /\$\s?\d[\d,]*\s?(?:-|–|to)\s?\$?\s?\d/i
const EXACT_RE = /\$\s?\d[\d,]+(?:\.\d{2})?/
const COMPLAINT_RE = /\b(refund|complaint|complain|angry|terrible|worst|disappointed|never again|unacceptable|rude)\b/i
const REFUSAL_RE = /\b(we don'?t|we do not|can'?t help|not something we|outside our|we don'?t offer|unable to|don'?t service)\b/i
const BOOK_RE = /\b(book|booked|schedule|scheduled|appointment|set you up|come out|see you (on|at)|confirmed for)\b/i

function mkSignal(
  tenantId: string,
  agentId: string | null,
  type: SignalType,
  unit: { conversation_id: string; channel: string; created_at: string; sentiment?: string | null },
  payload: Record<string, unknown>,
  evidence: string,
  confidence = 0.7,
  subject_ref: Record<string, unknown> = {},
): BusinessSignal {
  return {
    tenant_id: tenantId,
    ai_employee_id: agentId,
    type,
    channel: unit.channel,
    conversation_id: unit.conversation_id,
    subject_ref,
    payload,
    evidence: evidence.slice(0, 300),
    sentiment: unit.sentiment ?? null,
    confidence,
    occurred_at: unit.created_at,
  }
}

function pricingStyle(text: string): string {
  if (RANGE_RE.test(text)) return 'range'
  if (EXACT_RE.test(text)) return 'exact'
  if (/\b(estimate|free quote|depends|varies|after (we|I) see|come (out|take a look))\b/i.test(text)) return 'estimate_first'
  return 'deflected'
}

// ── Deterministic perception (no LLM, fast, reliable) ────────────────────────────
function ruleSignals(harvest: Harvest, tenantId: string, agentId: string | null): BusinessSignal[] {
  const out: BusinessSignal[] = []

  for (const u of harvest.units) {
    if (u.human_takeover) {
      out.push(mkSignal(tenantId, agentId, 'escalation_moment', u, { reason: 'human_takeover' }, u.summary || 'Owner took over the conversation', 0.9))
    }
    if (u.sentiment === 'negative') {
      out.push(mkSignal(tenantId, agentId, 'complaint', u, { sentiment: 'negative' }, u.summary || 'Negative-sentiment conversation', 0.7))
    }

    const msgs = u.messages
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]
      const content = (m.content || '').trim()
      if (!content) continue

      // Owner's own words (gold) — and a correction when it follows an AI message.
      if (m.role === 'agent') {
        out.push(mkSignal(tenantId, agentId, 'owner_message', u, { text: content }, content, 0.85))
        const prevAi = [...msgs.slice(0, i)].reverse().find((x) => x.role === 'assistant')
        if (prevAi) {
          out.push(
            mkSignal(tenantId, agentId, 'correction_delta', u, { ai_said: prevAi.content.slice(0, 300), owner_said: content }, `AI: "${prevAi.content.slice(0, 80)}" → Owner: "${content.slice(0, 80)}"`, 0.8),
          )
        }
        if (COMPLAINT_RE.test(content) || REFUSAL_RE.test(content)) {
          out.push(mkSignal(tenantId, agentId, 'refusal', u, { text: content }, content, 0.65))
        }
      }

      // Pricing exchange: a customer pricing question + the next staff reply.
      if (m.role === 'user' && PRICE_RE.test(content)) {
        const reply = msgs.slice(i + 1).find((x) => x.role === 'assistant' || x.role === 'agent')
        if (reply) {
          const style = pricingStyle(reply.content)
          out.push(
            mkSignal(tenantId, agentId, 'pricing_response', u, { question: content.slice(0, 160), answer: reply.content.slice(0, 200), style, answered_by: reply.role }, `Q: "${content.slice(0, 60)}" → ${style}`, 0.75),
          )
        }
      }

      // Booking language by staff.
      if ((m.role === 'assistant' || m.role === 'agent') && BOOK_RE.test(content)) {
        out.push(mkSignal(tenantId, agentId, 'booking_decision', u, { text: content.slice(0, 200), by: m.role }, content, 0.6))
      }
    }
  }

  // Outcomes (from leads + appointments) — the reward substrate for later phases.
  for (const l of harvest.leads) {
    out.push({
      tenant_id: tenantId, ai_employee_id: agentId, type: 'outcome', channel: null,
      conversation_id: null, subject_ref: { lead_source: l.source }, payload: { kind: 'lead', status: l.status, responded: !!l.responded_at },
      evidence: `Lead ${l.status}${l.source ? ` via ${l.source}` : ''}`, sentiment: null, confidence: 0.95, occurred_at: l.created_at,
    })
  }
  for (const a of harvest.appointments) {
    out.push({
      tenant_id: tenantId, ai_employee_id: agentId, type: 'outcome', channel: null,
      conversation_id: null, subject_ref: {}, payload: { kind: 'appointment', status: a.status },
      evidence: `Appointment ${a.status}`, sentiment: null, confidence: 0.95, occurred_at: a.created_at,
    })
  }

  return out
}

// ── LLM perception (one bounded call) — enriches with judgment-level signals ──────
// Classification/extraction → CHEAP model tier, gated by the shared budget.
async function llmSignals(harvest: Harvest, tenantId: string, agentId: string | null, budget?: LearningBudget): Promise<BusinessSignal[]> {
  // Prefer the richest conversations: takeovers, negative, pricing, longer threads.
  const ranked = [...harvest.units]
    .filter((u) => u.messages.length >= 2)
    .sort((a, b) => Number(b.human_takeover) - Number(a.human_takeover) || b.messages.length - a.messages.length)
    .slice(0, 12)
  if (!ranked.length) return []

  const digest = ranked
    .map((u, i) => {
      const lines = u.messages.slice(0, 14).map((m) => `${m.role}: ${m.content.slice(0, 240)}`).join('\n')
      return `# Conversation ${i + 1} [${u.channel}${u.human_takeover ? ' · OWNER TOOK OVER' : ''}${u.sentiment ? ` · ${u.sentiment}` : ''}] (conv:${u.conversation_id})\n${lines}`
    })
    .join('\n\n')
    .slice(0, 16000)

  const prompt = `From the real business conversations below, extract structured BEHAVIOR SIGNALS — concrete moments that reveal how THIS business operates. Do not summarize; emit atomic signals.

Return ONLY a JSON array. Each item:
{
  "type": one of ["objection_handling","refusal","pricing_response","booking_decision","faq_pattern","phrase_usage"],
  "conversation_id": the conv id it came from (or null),
  "channel": the channel,
  "payload": { ... short structured fields, e.g. {"objection":"too expensive","response":"offered a discount"} or {"question":"...","answer":"..."} or {"phrase":"..."} },
  "evidence": "a short quote",
  "confidence": 0.0-1.0
}
Only include things actually present. Return [] if nothing clear.

CONVERSATIONS:
${digest}`

  const raw = await callModel(prompt, 1800, { budget, tier: 'cheap' })
  const items = extractJsonArray(raw)
  const valid = new Set(['objection_handling', 'refusal', 'pricing_response', 'booking_decision', 'faq_pattern', 'phrase_usage'])
  const byId = new Map(harvest.units.map((u) => [u.conversation_id, u]))

  return items
    .filter((s) => s && valid.has(s.type))
    .slice(0, 40)
    .map((s) => {
      const u = (s.conversation_id && byId.get(s.conversation_id)) || ranked[0]
      return mkSignal(
        tenantId, agentId, s.type as SignalType,
        { conversation_id: u.conversation_id, channel: s.channel || u.channel, created_at: u.created_at, sentiment: u.sentiment },
        (s.payload && typeof s.payload === 'object' ? s.payload : {}) as Record<string, unknown>,
        String(s.evidence || ''),
        Math.max(0, Math.min(1, typeof s.confidence === 'number' ? s.confidence : 0.6)),
      )
    })
}

export async function perceive(harvest: Harvest, tenantId: string, agentId: string | null, budget?: LearningBudget): Promise<BusinessSignal[]> {
  const rules = ruleSignals(harvest, tenantId, agentId) // deterministic, free — always runs
  let llm: BusinessSignal[] = []
  try { llm = await llmSignals(harvest, tenantId, agentId, budget) } catch { /* perception still works on rules alone */ }
  return [...rules, ...llm]
}

// Public helper so the LLM unit selection logic can be reused by the distiller.
export type { InteractionUnit }

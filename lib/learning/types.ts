// ── Business Learning Engine v1 — "watching and learning" ───────────────────────────
// Observation only. Every customer interaction becomes structured business signals;
// signals distill into behavior hypotheses (the Owner Behavior Model, in the background);
// hypotheses that clear an evidence bar become owner suggestions. NOTHING here changes
// customer-facing behavior — the runtime keeps using the approved Playbook only.

// The atomic unit of business intelligence. Emitted from data the channels already
// persist (read-only), never by instrumenting the live pipeline.
export type SignalType =
  | 'pricing_response' // how the business answered a pricing question
  | 'booking_decision' // booked / offered to book
  | 'escalation_moment' // handed to a human (takeover)
  | 'owner_message' // the owner's own words (gold — real voice)
  | 'correction_delta' // owner replaced/added to what the AI said
  | 'objection_handling' // a customer objection + the response
  | 'refusal' // the business declined a job/customer
  | 'outcome' // booked / lost / cancelled / no_show / completed
  | 'complaint' // negative sentiment / complaint
  | 'faq_pattern' // a recurring customer question
  | 'phrase_usage' // a phrase the owner/AI uses repeatedly

export interface BusinessSignal {
  tenant_id: string
  ai_employee_id: string | null
  type: SignalType
  channel: string | null
  conversation_id: string | null
  subject_ref: Record<string, unknown> // { message_id, lead_id, appointment_id }
  payload: Record<string, unknown> // structured details of the signal
  evidence: string // short human-readable snippet
  sentiment: string | null
  confidence: number // 0..1 perception confidence
  occurred_at: string // ISO
}

export interface InteractionUnit {
  conversation_id: string
  channel: string
  human_takeover: boolean
  sentiment: string | null
  summary: string | null
  created_at: string
  messages: { role: string; content: string; timestamp: string }[]
}

// Confidence tiers — we surface low/medium/high (and keep "observed" internal-only),
// each phrased to the owner at the right strength.
export type ConfidenceTier = 'observed' | 'low' | 'medium' | 'high'

// A distilled pattern of business behavior — a candidate row of the Owner Behavior Model.
// `dimension` maps to an OwnerPlaybook section key so suggestions slot into the existing
// Playbook review UI.
export interface BehaviorHypothesis {
  dimension: string
  facet: string // which focused distillation pass produced it
  statement: string
  evidence_count: number
  consistency: number // 0..1 — how uniformly the business does this
  confidence: number // 0..1
  tier: ConfidenceTier
  gold: boolean // derived from owner_message / correction_delta / escalation (owner's own action)
  source_signal_types: string[]
  channels: string[]
  examples: { customer?: string; reply?: string; note?: string }[]
  outcome_note?: string // e.g. "appears in booked conversations"
  proposed: { text?: string; customer?: string; reply?: string } // ready-to-approve rule
  phrasing: string // safe owner-facing suggestion line, tuned to the tier
  show_to_owner: boolean
}

export interface LearningReport {
  tenantId: string
  tenantName: string
  agentId: string | null
  window: { since: string | null; until: string }
  sources: string[]
  counts: {
    conversations: number
    messages: number
    leads: number
    appointments: number
    signals: number
    signalsByType: Record<string, number>
  }
  hypotheses: BehaviorHypothesis[]
  suggestions: BehaviorHypothesis[] // hypotheses that meet the evidence/confidence bar
  persisted: boolean
  notes: string[]
}

// Evidence bar before a hypothesis is worth showing the owner.
export const EVIDENCE_MIN = 3
export const CONFIDENCE_MIN = 0.6

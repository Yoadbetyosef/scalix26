// ── Owner Playbook ──────────────────────────────────────────────────────────────
// The business owner's judgment turned into structured software: how they answer,
// sell, schedule, qualify, handle objections, and escalate. Generated from the website
// scan + onboarding interview + business profile (+ later, learned from conversations),
// reviewed/approved by the owner, then compiled into the prompt every channel reads.
//
// Vertical-agnostic by design — the same shape works for a locksmith, jeweler, med spa,
// plumber, dentist, or lawyer. Sections are mostly plain rule lists so they're trivial
// to display, edit, and extend.

export interface PlaybookExample {
  customer: string // what the customer says/asks
  reply: string // how the owner/AI should respond
  channel?: string // optional channel hint (e.g. 'voice', 'sms')
}

export interface OwnerPlaybook {
  // Identity & voice
  business_summary: string // 1–3 sentences: what the business does, who it serves
  tone_profile: string // e.g. "Warm, professional, concise. Confident, never pushy."
  response_style: string // length/format guidance per the owner's preference
  sales_style: string // how hard to push toward booking

  // Knowledge
  services_products: string[]
  pricing_rules: string[] // e.g. "Give ranges, never exact quotes unless approved"

  // Operating rules
  booking_rules: string[] // when/how to book
  qualification_rules: string[] // what makes a customer worth booking
  escalation_rules: string[] // when to hand off to the owner
  emergency_rules: string[] // urgent/after-hours handling
  follow_up_rules: string[]
  channel_rules: string[] // per-channel behavior (voice vs SMS vs email vs social)
  uncertainty_rules: string[] // what to do when unsure (the safety net)

  // Behavior
  objection_handling: string[] // "When the customer says X, respond Y"
  do_say: string[]
  do_not_say: string[]
  high_value_signals: string[]
  low_value_signals: string[]

  // Examples (owner's real voice)
  common_questions: PlaybookExample[]
  examples: PlaybookExample[]
}

export type PlaybookStatus = 'none' | 'draft' | 'approved'

// The ordered sections rendered in the UI and compiled into the prompt. Keeping this as
// the single source of order means adding a section later is a one-line change.
export const PLAYBOOK_SECTIONS: { key: keyof OwnerPlaybook; label: string; kind: 'text' | 'list' | 'examples' }[] = [
  { key: 'business_summary', label: 'Business Summary', kind: 'text' },
  { key: 'tone_profile', label: 'Tone & Personality', kind: 'text' },
  { key: 'response_style', label: 'Response Style', kind: 'text' },
  { key: 'sales_style', label: 'Sales Style', kind: 'text' },
  { key: 'services_products', label: 'Services / Products', kind: 'list' },
  { key: 'pricing_rules', label: 'Pricing Rules', kind: 'list' },
  { key: 'booking_rules', label: 'Booking Rules', kind: 'list' },
  { key: 'qualification_rules', label: 'Qualification Rules', kind: 'list' },
  { key: 'escalation_rules', label: 'Escalation Rules', kind: 'list' },
  { key: 'emergency_rules', label: 'Emergency Rules', kind: 'list' },
  { key: 'objection_handling', label: 'Objection Handling', kind: 'list' },
  { key: 'follow_up_rules', label: 'Follow-up Rules', kind: 'list' },
  { key: 'channel_rules', label: 'Channel Rules', kind: 'list' },
  { key: 'uncertainty_rules', label: 'When Unsure', kind: 'list' },
  { key: 'do_say', label: 'Always Say', kind: 'list' },
  { key: 'do_not_say', label: 'Never Say', kind: 'list' },
  { key: 'high_value_signals', label: 'High-Value Leads', kind: 'list' },
  { key: 'low_value_signals', label: 'Low-Value Leads', kind: 'list' },
  { key: 'common_questions', label: 'Common Questions', kind: 'examples' },
  { key: 'examples', label: 'Owner Response Examples', kind: 'examples' },
]

export function emptyPlaybook(): OwnerPlaybook {
  return {
    business_summary: '',
    tone_profile: '',
    response_style: '',
    sales_style: '',
    services_products: [],
    pricing_rules: [],
    booking_rules: [],
    qualification_rules: [],
    escalation_rules: [],
    emergency_rules: [],
    follow_up_rules: [],
    channel_rules: [],
    uncertainty_rules: [],
    objection_handling: [],
    do_say: [],
    do_not_say: [],
    high_value_signals: [],
    low_value_signals: [],
    common_questions: [],
    examples: [],
  }
}

// Normalize anything (LLM output, partial edits) into a complete, well-typed playbook so
// the UI and compiler never hit undefined.
export function normalizePlaybook(input: unknown): OwnerPlaybook {
  const base = emptyPlaybook()
  if (!input || typeof input !== 'object') return base
  const obj = input as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const list = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : []
  const examples = (v: unknown): PlaybookExample[] =>
    Array.isArray(v)
      ? v
          .map((x) => {
            const e = (x || {}) as Record<string, unknown>
            return { customer: str(e.customer), reply: str(e.reply), channel: str(e.channel) || undefined }
          })
          .filter((e) => e.customer || e.reply)
      : []

  const out = base as unknown as Record<string, unknown>
  for (const s of PLAYBOOK_SECTIONS) {
    if (s.kind === 'text') out[s.key] = str(obj[s.key])
    else if (s.kind === 'list') out[s.key] = list(obj[s.key])
    else out[s.key] = examples(obj[s.key])
  }
  return base
}

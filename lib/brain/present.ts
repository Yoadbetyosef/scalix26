// ── The AI-COO presenter ─────────────────────────────────────────────────────────
// Pure transformation of the EXISTING deterministic data (understanding, recommendations,
// patterns, DNA) into an executive experience: COO-voiced narrative, executive priorities,
// estimated impact, living DNA lines, and honest open questions. It changes NOTHING about
// the engine or Business Confidence — it only decides how the Brain SPEAKS.

export type Priority = 'critical' | 'high' | 'watching' | 'learning'
export const PRIORITY_META: Record<Priority, { label: string; rank: number; tone: string; dot: string }> = {
  critical: { label: 'Critical', rank: 0, tone: 'text-rose-700 bg-rose-50', dot: 'bg-rose-500' },
  high: { label: 'High Impact', rank: 1, tone: 'text-amber-700 bg-amber-50', dot: 'bg-amber-500' },
  watching: { label: 'Worth Watching', rank: 2, tone: 'text-blue-700 bg-blue-50', dot: 'bg-blue-500' },
  learning: { label: 'Learning', rank: 3, tone: 'text-gray-600 bg-gray-100', dot: 'bg-gray-400' },
}

export function priorityOf(confidence: number, category: string): Priority {
  const revenueish = ['sales', 'pricing'].includes(category)
  if (confidence >= 70 && revenueish) return 'critical'
  if (confidence >= 55) return 'high'
  if (confidence >= 35) return 'watching'
  return 'learning'
}

// First-person understanding, in the COO's voice, per understanding_key.
const COO: Record<string, { statement: string; question?: string }> = {
  pricing_major_concern: { statement: "I've realized pricing is one of the strongest forces in your customers' decisions — how it's handled shapes who buys." },
  slow_response_costing_leads: { statement: "I've found that slow first replies are quietly costing you leads — response speed is one of your biggest levers.", question: 'the exact response time where leads start dropping off' },
  losing_booking_ready: { statement: "I've spotted booking-ready customers slipping away before they get scheduled — the easiest revenue to win back." },
  unpaid_revenue_pipeline: { statement: "I've noticed real money sitting in unpaid payments — collecting it is faster than finding new customers." },
  cancellations_hurting: { statement: "I'm seeing cancellations eat into revenue you already earned.", question: 'which jobs and times cancel most' },
  complaints_need_attention: { statement: "I'm noticing complaints often enough that they're starting to shape your reputation." },
  primary_channel_known: { statement: 'I now understand where most of your customers come from — that channel is where speed matters most.' },
  pricing_leads_going_cold: { statement: "I've identified a revenue leak: price-curious customers stall out with no follow-up.", question: 'why customers go quiet after asking about price' },
  uncaptured_payments: { statement: "I've found customers who were ready to pay but never got a link — a direct, recoverable miss." },
  revenue_flowing: { statement: 'I can see real revenue flowing through you now — enough to start learning what earns the most.' },
}

export function cooStatement(key: string, fallback: string): string {
  return COO[key]?.statement || `I've been noticing something: ${fallback.charAt(0).toLowerCase()}${fallback.slice(1)}`
}

// Estimated impact from REAL pattern counts — gated by confidence, never invented.
export function estimatedImpact(key: string, patternValue: (k: string) => number | null, confidence: number): string {
  if (confidence < 40) return 'Not enough evidence yet — I need more data before I estimate.'
  const n = (pk: string) => Math.round(patternValue(pk) || 0)
  switch (key) {
    case 'losing_booking_ready': return `Up to ${n('missed_booking')} booking-ready customers could be recovered.`
    case 'pricing_leads_going_cold': return `~${n('missed_pricing_followup')} stalled price leads could be re-engaged.`
    case 'uncaptured_payments': return `~${n('missed_payment')} ready-to-pay customers could be captured.`
    case 'unpaid_revenue_pipeline': return `${n('payments_pending')} pending payment(s) could be collected now.`
    case 'slow_response_costing_leads': return `Faster first replies protect leads you're currently losing to the wait.`
    case 'primary_channel_known': return 'Focusing speed on your top channel is where more booked jobs come from.'
    default: return 'A steady lift once you act on it.'
  }
}

// Living DNA — rotating "learning" lines by strand + state. UI cycles through them.
const DNA_LINES: Record<string, string[]> = {
  sales: ['Learning your buying triggers…', 'Learning what closes deals…', 'Learning which leads become customers…', 'Learning objection patterns…'],
  pricing: ['Learning estimate acceptance…', 'Learning deposit patterns…', 'Learning how price shapes decisions…'],
  communication: ['Learning response quality…', 'Learning follow-up timing…', 'Learning what phrasing works…'],
  customer: ['Learning who buys most…', 'Learning why customers cancel…', 'Learning repeat-customer behavior…'],
  operations: ['Learning your busiest hours…', 'Learning where time leaks…', 'Learning your booking flow…'],
}
export function dnaLine(strand: string, strength: number, tick: number): string {
  const lines = DNA_LINES[strand] || ['Learning your business…']
  if (strength >= 65) return `I understand your ${strand} well — refining the details.`
  return lines[tick % lines.length]
}

// Open questions — from understandings the Brain has (with a `question`) + strands it can't
// speak to yet. Honest about what it doesn't know.
export function openQuestions(presentKeys: string[], weakStrands: string[]): string[] {
  const qs: string[] = []
  for (const k of presentKeys) { const q = COO[k]?.question; if (q) qs.push(q) }
  const strandQ: Record<string, string> = {
    sales: 'which customers are most likely to buy', pricing: 'which pricing approach converts best',
    communication: 'which follow-up timing works best', customer: 'why some customers cancel',
    operations: 'where your busiest hours really are',
  }
  for (const s of weakStrands) if (strandQ[s]) qs.push(strandQ[s])
  return [...new Set(qs)].slice(0, 5)
}

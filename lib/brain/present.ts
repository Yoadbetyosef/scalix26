// ── The AI-COO presenter ─────────────────────────────────────────────────────────
// Pure transformation of the EXISTING deterministic data (understanding, recommendations,
// patterns, DNA) into an executive experience: COO-voiced narrative, executive priorities,
// estimated impact, living DNA lines, and honest open questions. It changes NOTHING about
// the engine or Business Confidence — it only decides how the Brain SPEAKS.

import type { BrainView } from './view'

// The AI COO's voice. Was an ElevenLabs id with expressive settings (stability/style/speaker boost)
// that Aura has no equivalent for; the briefing now speaks in the same voice family as the phone and
// the sandbox. A cached briefing sounds different than it did — the deliberate price of one vendor.
export const BUSINESS_BRAIN_COO_VOICE = 'aura-2-arcas-en'

const DNA_LABEL: Record<string, string> = { sales: 'Sales', pricing: 'Pricing', communication: 'Communication', customer: 'Customer', operations: 'Operations' }

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
// Real per-channel study list for the hero ("84 conversations, 16 calls, ...").
export interface Sources { total: number; voice: number; sms: number; email: number; facebook: number; instagram: number; whatsapp: number }
export function studyLines(s: Sources): { label: string; count: number }[] {
  return [
    { label: 'conversations', count: s.total },
    { label: 'phone calls', count: s.voice },
    { label: 'text messages', count: s.sms },
    { label: 'emails', count: s.email },
    { label: 'Facebook messages', count: s.facebook },
    { label: 'Instagram messages', count: s.instagram },
    { label: 'WhatsApp messages', count: s.whatsapp },
  ].filter((x) => x.count > 0)
}

// The senses the Brain doesn't have yet — each future integration gives it another one.
export const COMING_NEXT = ['Google Reviews', 'Stripe payments', 'Calendar', 'CRM', 'Call recordings']

// Counter-intuitive findings — only surfaced when the REAL data supports them. Never faked.
export function surprisedMe(v: (k: string) => number | null): string[] {
  const out: string[] = []
  const pricing = v('pricing_questions')       // % of conversations
  const slow = v('response_time_avg')           // minutes
  const unans = v('unanswered_conversations')
  const missedPricing = v('missed_pricing_followup')
  if ((pricing == null || pricing < 12) && ((slow != null && slow > 30) || (unans != null && unans > 0) || (missedPricing != null && missedPricing > 0)))
    out.push("I expected price to be your biggest issue — it isn't. Customers slip away more from slow or missing follow-ups than from cost.")
  const booking = v('missed_booking')
  if (booking != null && booking > 0)
    out.push(`More customers than I'd expect asked to book but were never scheduled — that's revenue sitting right in your conversations.`)
  return out.slice(0, 2)
}

// ── Morning-briefing script, segmented for highlight-sync ─────────────────────────
export interface BriefSeg { text: string; section: string }
export function briefingSegments(v: BrainView): BriefSeg[] {
  const pv = (k: string) => v.patterns.find((p) => p.pattern_key === k)?.metric_value ?? null
  const study = studyLines(v.sources)
  const segs: BriefSeg[] = [{ section: 'hero', text: `${new Date().getHours() < 12 ? 'Good morning' : 'Hey'}. I studied your business while you were away.` }]
  if (study[0]) segs.push({ section: 'hero', text: `I went through ${study.slice(0, 3).map((x) => `${x.count} ${x.label}`).join(', ')}. Here's what I understand better today.` })
  const learned = v.understandings.filter((u) => u.business_confidence >= 40)
  if (learned[0]) segs.push({ section: 'understand', text: `First — ${cooStatement(learned[0].understanding_key, learned[0].statement)}` })
  const top = v.recommendations[0]
  if (top) {
    const u = v.understandings.find((x) => x.id === top.understanding_id)
    const impact = estimatedImpact(u?.understanding_key || '', pv, top.business_confidence)
    segs.push({ section: 'focus', text: `The thing I'd focus on today is ${top.title.charAt(0).toLowerCase()}${top.title.slice(1)}.` + (/not enough/i.test(impact) ? ` I'm only ${top.business_confidence}% sure so far, so I'm still watching — but it may be recoverable.` : ` Honestly, ${impact.charAt(0).toLowerCase()}${impact.slice(1)}`) })
  }
  const surprised = surprisedMe(pv)
  if (surprised[0]) segs.push({ section: 'surprised', text: surprised[0] })
  const topDna = [...v.dna].sort((a, b) => b.strength - a.strength)[0]
  if (topDna && topDna.strength > 0) segs.push({ section: 'dna', text: `Right now, ${DNA_LABEL[topDna.dna_strand].toLowerCase()} is where you're strongest — I'm still getting a feel for the rest.` })
  const weak = v.dna.filter((d) => d.strength < 30).map((d) => d.dna_strand)
  const qs = openQuestions(v.understandings.map((u) => u.understanding_key), weak)
  if (qs[0]) segs.push({ section: 'questions', text: `The thing I keep chewing on is ${qs[0]}, so I'll keep watching before I make a call.` })
  segs.push({ section: 'hero', text: "That's my read for now. I'll update you when I've got stronger evidence." })
  return segs
}
export function briefingText(v: BrainView): string { return briefingSegments(v).map((s) => s.text).join(' ') }

// ── Ask my COO — guided, answered ONLY from real data (never hallucinate) ─────────
export const ASK_QUESTIONS = [
  { key: 'learned', q: 'What did you learn today?' },
  { key: 'worries', q: 'What worries you?' },
  { key: 'losing', q: 'Where am I losing customers?' },
  { key: 'improve', q: 'What should I improve first?' },
  { key: 'figuring', q: "What are you still trying to figure out?" },
  { key: 'automate', q: 'What should I automate next?' },
] as const

export function answerCooQuestion(key: string, v: BrainView): string {
  const pv = (k: string) => v.patterns.find((p) => p.pattern_key === k)?.metric_value ?? null
  const n = (k: string) => Math.round(pv(k) || 0)
  const unknown = "I don't know yet. I need more data before I can answer that confidently."
  switch (key) {
    case 'learned': {
      const l = v.understandings.filter((u) => u.business_confidence >= 40)
      if (!l.length) return unknown
      return l.slice(0, 2).map((u) => cooStatement(u.understanding_key, u.statement)).join('  Also, ')
    }
    case 'worries': {
      const bits: string[] = []
      if (pv('missed_booking')) bits.push(`${n('missed_booking')} booking-ready customers who were never scheduled`)
      if (pv('missed_payment')) bits.push(`${n('missed_payment')} customers who mentioned paying but never got a link`)
      return bits.length ? `What I'd keep an eye on: ${bits.join(', and ')}. These may be recoverable — I can't prove the dollar value yet.` : "Nothing alarming yet — I'm still watching."
    }
    case 'losing': {
      const bits: string[] = []
      if (pv('unanswered_conversations')) bits.push(`${n('unanswered_conversations')} conversations got no reply at all`)
      const slow = pv('response_time_avg'); if (slow != null && slow > 30) bits.push(`first replies average about ${Math.round(slow)} minutes`)
      if (pv('missed_pricing_followup')) bits.push(`${n('missed_pricing_followup')} price-curious customers stalled with no follow-up`)
      return bits.length ? `Most likely here: ${bits.join('; ')}.` : "I don't have clear evidence of where you're losing customers yet — I need more data."
    }
    case 'improve': {
      const top = v.recommendations[0]
      return top ? `I'd start with: ${top.title}. ${top.why}` : "I don't have a strong recommendation yet — I need more evidence."
    }
    case 'figuring': {
      const weak = v.dna.filter((d) => d.strength < 30).map((d) => d.dna_strand)
      const qs = openQuestions(v.understandings.map((u) => u.understanding_key), weak)
      return qs.length ? `I'm still figuring out ${qs.slice(0, 2).join(', and ')}.` : "Not much right now — I'm fairly settled on what I'm seeing."
    }
    case 'automate': {
      if (pv('missed_payment')) return "Payment links. Some customers were ready to pay but never got one — turning on Payment Collection would let me send secure links automatically."
      if (pv('missed_pricing_followup')) return "Follow-ups on price questions — I could flag price-curious leads for a fast follow-up automatically."
      return "Nothing urgent to automate yet — let me gather more evidence first."
    }
  }
  return unknown
}

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

import type { Pattern, UnderstandingDraft, DnaStrand } from './types'
import { businessConfidence, evidenceStrength, evidenceSummary } from './confidence'

// ── Patterns → Business Understanding (deterministic rules) ───────────────────────
// Each understanding is meaning derived from a real pattern, assigned to a DNA strand, and
// scored with deterministic Business Confidence. Understanding is NEVER derived from raw
// conversations directly — always from a pattern.

function summaryFor(p: Pattern): string {
  const parts: { conversations?: number; payments?: number; appointments?: number; weeksObserved: number } = { weeksObserved: p.weeks_observed }
  if (p.category === 'payment') parts.payments = p.evidence_count
  else if (p.category === 'booking') parts.appointments = p.evidence_count
  else parts.conversations = p.evidence_count
  return evidenceSummary(parts)
}

function build(p: Pattern, strand: DnaStrand, key: string, title: string, statement: string): UnderstandingDraft {
  const confidence = businessConfidence({ evidenceCount: p.evidence_count, weeksObserved: p.weeks_observed, consistency: p.consistency, outcomeRatio: p.outcome_ratio })
  return {
    dna_strand: strand, understanding_key: key, title, statement, source_pattern_keys: [p.pattern_key],
    business_confidence: confidence,
    evidence_strength: evidenceStrength(confidence, p.evidence_count, p.weeks_observed),
    evidence_summary: summaryFor(p),
  }
}

// key threshold + mapping. Only fires when the underlying pattern crosses a sensible bar.
export function deriveUnderstanding(patterns: Pattern[]): UnderstandingDraft[] {
  const P = new Map(patterns.map((p) => [p.pattern_key, p]))
  const out: UnderstandingDraft[] = []
  const get = (k: string) => P.get(k)

  const pricing = get('pricing_questions')
  if (pricing && (pricing.metric_value ?? 0) >= 12)
    out.push(build(pricing, 'pricing', 'pricing_major_concern', 'Pricing is a major buying concern', 'Pricing is one of the biggest things customers ask about — how you handle it strongly shapes whether they buy.'))

  const slow = get('response_time_avg')
  const unans = get('unanswered_conversations')
  const slowSrc = (slow && (slow.metric_value ?? 0) > 30) ? slow : (unans ? unans : null)
  if (slowSrc)
    out.push(build(slowSrc, 'operations', 'slow_response_costing_leads', 'Slow responses may be costing leads', 'Some customers wait too long for a first reply — response speed is one of the biggest drivers of whether a lead converts.'))

  const missedBook = get('missed_booking')
  if (missedBook)
    out.push(build(missedBook, 'sales', 'losing_booking_ready', 'Booking-ready customers are slipping through', 'Customers who ask to book but never get scheduled are the easiest revenue to recover.'))

  const pendingPay = get('payments_pending')
  if (pendingPay)
    out.push(build(pendingPay, 'sales', 'unpaid_revenue_pipeline', 'You have unpaid revenue in the pipeline', 'Money is sitting in pending payments — collecting it is faster than finding new customers.'))

  const cancel = get('cancellation_rate')
  if (cancel && (cancel.metric_value ?? 0) >= 15)
    out.push(build(cancel, 'customer', 'cancellations_hurting', 'Cancellations are eating into booked revenue', 'A meaningful share of booked appointments are cancelling — worth understanding why.'))

  const complaints = get('complaint_questions')
  if (complaints && (complaints.metric_value ?? 0) >= 8)
    out.push(build(complaints, 'customer', 'complaints_need_attention', 'Some customers are raising complaints', 'Complaints are showing up often enough to be worth a closer look — they shape reputation and retention.'))

  const topCh = get('top_channel')
  if (topCh)
    out.push(build(topCh, 'communication', 'primary_channel_known', 'You know where your customers come from', 'Most of your customers reach you on one channel — that\'s where speed and quality matter most.'))

  const coldPricing = get('missed_pricing_followup')
  if (coldPricing)
    out.push(build(coldPricing, 'sales', 'pricing_leads_going_cold', 'Pricing-ready leads may be going cold', 'Customers asked about price but the conversation stalled with no booking — classic lost-revenue leak.'))

  const missedPay = get('missed_payment')
  if (missedPay)
    out.push(build(missedPay, 'sales', 'uncaptured_payments', 'Ready-to-pay customers aren\'t always captured', 'Some customers signalled they\'re ready to pay but never got a link — a direct, recoverable miss.'))

  const revenue = get('revenue_collected')
  if (revenue)
    out.push(build(revenue, 'operations', 'revenue_flowing', 'Payments are flowing through Scalix', 'Real revenue is being collected here — the foundation for measuring what actually makes money.'))

  return out
}

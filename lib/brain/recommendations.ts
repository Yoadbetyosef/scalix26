import type { UnderstandingDraft, RecommendationDraft } from './types'

// ── Understanding → Recommendations ──────────────────────────────────────────────
// Every recommendation references an understanding (never a raw conversation) and carries
// that understanding's Business Confidence. Each answers Why / How / What-if-ignored.

interface Tmpl { category: string; title: string; why: string; how: string; if_ignored: string; estimated_impact: string | null }

const TEMPLATES: Record<string, Tmpl> = {
  pricing_major_concern: {
    category: 'pricing', title: 'Lead with value on pricing questions',
    why: 'Customers ask about price constantly — it\'s a top buying trigger, not just a number.',
    how: 'Have the AI answer pricing confidently, tie it to value, and qualify the job before quoting.',
    if_ignored: 'Price-focused customers may keep shopping around and pick whoever answers best first.',
    estimated_impact: 'Higher close rate on price-sensitive leads.',
  },
  slow_response_costing_leads: {
    category: 'operations', title: 'Respond to new leads faster',
    why: 'Some customers wait too long for a first reply, and response speed strongly predicts conversion.',
    how: 'Let the AI answer instantly on every channel and flag anything it can\'t handle for a fast human follow-up.',
    if_ignored: 'Fast-moving leads go cold or book with a competitor who replied sooner.',
    estimated_impact: 'More leads converted from the same traffic.',
  },
  losing_booking_ready: {
    category: 'sales', title: 'Capture booking-ready customers before they leave',
    why: 'Customers asked to book but no appointment was created — this is the easiest revenue to recover.',
    how: 'Make sure the AI books directly or hands off a high-priority scheduling task the moment intent appears.',
    if_ignored: 'Ready-to-buy customers slip away after showing clear intent.',
    estimated_impact: 'Recovered bookings from existing conversations.',
  },
  unpaid_revenue_pipeline: {
    category: 'sales', title: 'Collect the money already in your pipeline',
    why: 'Payments are sitting pending — collecting them is faster than finding new customers.',
    how: 'Send or re-send secure payment links for pending items and follow up on unpaid ones.',
    if_ignored: 'Earned revenue stays uncollected and some of it never arrives.',
    estimated_impact: 'Faster cash collection from work already done.',
  },
  cancellations_hurting: {
    category: 'customer', title: 'Reduce appointment cancellations',
    why: 'A meaningful share of booked appointments are cancelling, eating into revenue you already won.',
    how: 'Add reminders and a quick confirmation step, and learn which jobs/times cancel most.',
    if_ignored: 'Booked revenue keeps leaking through cancellations.',
    estimated_impact: 'More booked jobs actually completed.',
  },
  complaints_need_attention: {
    category: 'customer', title: 'Get ahead of recurring complaints',
    why: 'Complaints appear often enough to affect reputation and repeat business.',
    how: 'Review the common complaint themes and have the AI escalate upset customers immediately.',
    if_ignored: 'Unaddressed complaints turn into bad reviews and lost repeat customers.',
    estimated_impact: 'Better reviews and retention.',
  },
  primary_channel_known: {
    category: 'communication', title: 'Double down on your strongest channel',
    why: 'Most of your customers come through one channel — that\'s where speed and quality matter most.',
    how: 'Make sure that channel is always covered instantly and consider focusing marketing there.',
    if_ignored: 'You may under-serve where most of your customers actually are.',
    estimated_impact: 'More from the channel that already works.',
  },
  pricing_leads_going_cold: {
    category: 'sales', title: 'Follow up faster with pricing leads',
    why: 'Customers asked about price but the conversation stalled with no booking — a classic lost-revenue leak.',
    how: 'Have the AI qualify the lead and send the owner a high-priority follow-up when a price question goes unanswered.',
    if_ignored: 'More pricing-ready leads go cold before booking.',
    estimated_impact: 'Recovered revenue from stalled price conversations.',
  },
  uncaptured_payments: {
    category: 'sales', title: 'Send a link the moment someone wants to pay',
    why: 'Some customers signalled they\'re ready to pay but never received a payment link.',
    how: 'Turn on Payment Collection so the AI can send a secure link the instant a customer wants to pay.',
    if_ignored: 'Ready-to-pay customers cool off and some never come back to pay.',
    estimated_impact: 'Directly recoverable payments.',
  },
  revenue_flowing: {
    category: 'operations', title: 'Start measuring what makes the most money',
    why: 'Real revenue is being collected — enough to start connecting services to dollars.',
    how: 'Keep payments flowing through Scalix so the Brain can learn which jobs and channels earn most.',
    if_ignored: 'You keep guessing which work is actually most profitable.',
    estimated_impact: 'Clearer view of your most profitable work.',
  },
}

export function deriveRecommendations(understandings: UnderstandingDraft[]): RecommendationDraft[] {
  const out: RecommendationDraft[] = []
  for (const u of understandings) {
    const t = TEMPLATES[u.understanding_key]
    if (!t) continue
    out.push({
      understanding_key: u.understanding_key, category: t.category, title: t.title,
      why: t.why, how: t.how, if_ignored: t.if_ignored, estimated_impact: t.estimated_impact,
      business_confidence: u.business_confidence, evidence_strength: u.evidence_strength,
    })
  }
  return out
}

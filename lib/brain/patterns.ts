import type { BrainData, BrainConv, Pattern } from './types'
import { timeStats } from './confidence'

// ── Deterministic pattern detectors ──────────────────────────────────────────────
// Every pattern is a real fact + the timing needed to score Business Confidence. No LLM.

const PRICE_RE = /\b(price|pricing|cost|costs|how much|quote|estimate|charge|rate|fee|deposit|\$\s?\d)/i
const BOOK_RE = /\b(book|schedule|appointment|availab|come out|slot|when can|set up)\b/i
const COMPLAINT_RE = /\b(refund|complaint|complain|angry|terrible|worst|disappointed|unacceptable|rude|late|never again)\b/i
const PAY_RE = /\b(pay|payment|invoice|pay now|deposit|by card|credit card)\b/i

const ms = (s: string) => new Date(s).getTime()
const firstUserMsg = (msgs: { role: string; content: string }[]) => msgs.find((m) => m.role === 'user')?.content || ''
const convHasUserMatch = (d: BrainData, c: BrainConv, re: RegExp) => (d.messagesByConv.get(c.id) || []).some((m) => m.role === 'user' && re.test(m.content))

function mk(
  category: Pattern['category'], pattern_key: string, title: string, description: string,
  metric_value: number | null, metric_unit: string | null, evidence_count: number,
  evidence_refs: Record<string, unknown>, dates: number[], outcome_ratio: number,
): Pattern {
  const { weeksObserved, consistency } = timeStats(dates)
  return { category, pattern_key, title, description, metric_value, metric_unit, evidence_count, evidence_refs, weeks_observed: weeksObserved, consistency, outcome_ratio }
}

// 1) Response time — first-reply latency + unanswered conversations.
function responseTime(d: BrainData): Pattern[] {
  const out: Pattern[] = []
  const latencies: number[] = []
  const answeredDates: number[] = []
  let unanswered = 0
  const unansweredDates: number[] = []
  for (const c of d.conversations) {
    const msgs = (d.messagesByConv.get(c.id) || []).slice().sort((a, b) => ms(a.timestamp) - ms(b.timestamp))
    const firstUser = msgs.find((m) => m.role === 'user')
    if (!firstUser) continue
    const reply = msgs.find((m) => (m.role === 'assistant' || m.role === 'agent') && ms(m.timestamp) >= ms(firstUser.timestamp))
    if (reply) { latencies.push((ms(reply.timestamp) - ms(firstUser.timestamp)) / 60000); answeredDates.push(ms(c.created_at)) }
    else { unanswered++; unansweredDates.push(ms(c.created_at)) }
  }
  if (latencies.length) {
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length
    out.push(mk('response_time', 'response_time_avg', 'Average first-response time',
      `On average you first reply to a customer in about ${Math.round(avg)} minute(s).`,
      Math.round(avg), 'minutes', latencies.length, { measured: latencies.length }, answeredDates, 0.35))
  }
  if (unanswered > 0) {
    out.push(mk('response_time', 'unanswered_conversations', 'Unanswered conversations',
      `${unanswered} conversation(s) received a customer message but no reply.`,
      unanswered, 'conversations', unanswered, { count: unanswered }, unansweredDates, 0.6))
  }
  return out
}

// 2) Top customer questions — pricing / booking / complaint share + the single top question.
function questions(d: BrainData): Pattern[] {
  const out: Pattern[] = []
  const total = d.conversations.length || 1
  const buckets: Record<string, { n: number; dates: number[] }> = {
    pricing: { n: 0, dates: [] }, booking: { n: 0, dates: [] }, complaint: { n: 0, dates: [] },
  }
  const topQ = new Map<string, number>()
  for (const c of d.conversations) {
    const q = firstUserMsg(d.messagesByConv.get(c.id) || [])
    if (PRICE_RE.test(q)) { buckets.pricing.n++; buckets.pricing.dates.push(ms(c.created_at)) }
    if (BOOK_RE.test(q)) { buckets.booking.n++; buckets.booking.dates.push(ms(c.created_at)) }
    if (COMPLAINT_RE.test(q)) { buckets.complaint.n++; buckets.complaint.dates.push(ms(c.created_at)) }
    const norm = q.toLowerCase().replace(/\d+/g, '#').replace(/[^a-z#\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (norm.length > 4) topQ.set(norm, (topQ.get(norm) || 0) + 1)
  }
  const share = (n: number) => Math.round((n / total) * 100)
  if (buckets.pricing.n) out.push(mk('questions', 'pricing_questions', 'Pricing questions',
    `${share(buckets.pricing.n)}% of conversations include a pricing question.`, share(buckets.pricing.n), '%',
    buckets.pricing.n, { conversations: buckets.pricing.n, of: total }, buckets.pricing.dates, 0.4))
  if (buckets.booking.n) out.push(mk('questions', 'booking_questions', 'Booking questions',
    `${share(buckets.booking.n)}% of conversations ask to book.`, share(buckets.booking.n), '%',
    buckets.booking.n, { conversations: buckets.booking.n, of: total }, buckets.booking.dates, 0.5))
  if (buckets.complaint.n) out.push(mk('questions', 'complaint_questions', 'Complaints raised',
    `${share(buckets.complaint.n)}% of conversations mention a complaint.`, share(buckets.complaint.n), '%',
    buckets.complaint.n, { conversations: buckets.complaint.n, of: total }, buckets.complaint.dates, 0.45))
  const top = [...topQ.entries()].sort((a, b) => b[1] - a[1])[0]
  if (top && top[1] >= 3) out.push(mk('questions', 'top_question', 'Most common question',
    `Customers most often ask: "${top[0]}" (${top[1]}×).`, top[1], 'times', top[1], { question: top[0], count: top[1] },
    d.conversations.map((c) => ms(c.created_at)), 0.3))
  return out
}

// 3) Booking behavior — booked / cancellations / conversion.
function booking(d: BrainData): Pattern[] {
  const out: Pattern[] = []
  const a = d.appointments
  if (!a.length) return out
  const dates = a.map((x) => ms(x.created_at))
  const cancelled = a.filter((x) => x.status === 'cancelled').length
  out.push(mk('booking', 'appointments_booked', 'Appointments booked',
    `${a.length} appointment(s) booked.`, a.length, 'appointments', a.length, { total: a.length }, dates, 0.8))
  if (a.length >= 3) {
    const rate = Math.round((cancelled / a.length) * 100)
    out.push(mk('booking', 'cancellation_rate', 'Cancellation rate',
      `${rate}% of appointments were cancelled.`, rate, '%', a.length, { cancelled, total: a.length }, dates, 0.8))
  }
  if (d.conversations.length >= 5) {
    const conv = Math.round((a.length / d.conversations.length) * 100)
    out.push(mk('booking', 'booking_conversion', 'Conversation → booking rate',
      `About ${conv}% of conversations turned into a booked appointment.`, conv, '%', d.conversations.length,
      { appointments: a.length, conversations: d.conversations.length }, dates, 0.7))
  }
  return out
}

// 4) Payment behavior — revenue collected / pending.
function payment(d: BrainData): Pattern[] {
  const out: Pattern[] = []
  const paid = d.payments.filter((p) => p.status === 'paid')
  const revenue = paid.reduce((s, p) => s + (p.amount || 0), 0) / 100
  const pendingPay = d.payments.filter((p) => p.status !== 'paid').length
  const pendingReq = d.paymentRequests.filter((r) => r.status === 'pending').length
  if (paid.length) out.push(mk('payment', 'revenue_collected', 'Revenue collected',
    `$${revenue.toFixed(2)} collected across ${paid.length} payment(s).`, Math.round(revenue), 'usd', paid.length,
    { payments: paid.length, revenue }, paid.map((p) => ms(p.created_at)), 0.95))
  if (pendingPay + pendingReq > 0) out.push(mk('payment', 'payments_pending', 'Unpaid payments in the pipeline',
    `${pendingPay + pendingReq} payment(s)/request(s) are pending.`, pendingPay + pendingReq, 'payments', pendingPay + pendingReq,
    { pendingPayments: pendingPay, pendingRequests: pendingReq },
    [...d.payments, ...d.paymentRequests].map((x) => ms(x.created_at)), 0.9))
  return out
}

// 5) Missed opportunities — asked but nothing created downstream.
function missed(d: BrainData): Pattern[] {
  const out: Pattern[] = []
  const apptContacts = new Set(d.appointments.map((a) => a.contact_id).filter(Boolean))
  const reqConvs = new Set(d.paymentRequests.map((r) => r.conversation_id).filter(Boolean))

  const pricingCold: number[] = []
  const bookMissed: number[] = []
  const payMissed: number[] = []
  for (const c of d.conversations) {
    const open = c.status === 'open'
    if (convHasUserMatch(d, c, PRICE_RE) && open && !c.human_takeover && !apptContacts.has(c.contact_id)) pricingCold.push(ms(c.created_at))
    if (convHasUserMatch(d, c, BOOK_RE) && !apptContacts.has(c.contact_id)) bookMissed.push(ms(c.created_at))
    if (convHasUserMatch(d, c, PAY_RE) && !reqConvs.has(c.id)) payMissed.push(ms(c.created_at))
  }
  if (pricingCold.length) out.push(mk('missed_opportunity', 'missed_pricing_followup', 'Pricing leads without follow-up',
    `${pricingCold.length} customer(s) asked about pricing but the conversation is still open with no booking.`,
    pricingCold.length, 'leads', pricingCold.length, { count: pricingCold.length }, pricingCold, 0.75))
  if (bookMissed.length) out.push(mk('missed_opportunity', 'missed_booking', 'Booking-ready customers not scheduled',
    `${bookMissed.length} customer(s) asked to book but no appointment was created.`,
    bookMissed.length, 'customers', bookMissed.length, { count: bookMissed.length }, bookMissed, 0.85))
  if (payMissed.length) out.push(mk('missed_opportunity', 'missed_payment', 'Ready-to-pay customers without a link',
    `${payMissed.length} customer(s) mentioned paying but no payment request was created.`,
    payMissed.length, 'customers', payMissed.length, { count: payMissed.length }, payMissed, 0.85))
  return out
}

// 6) Channel behavior — mix + fastest.
function channel(d: BrainData): Pattern[] {
  const out: Pattern[] = []
  const byCh = new Map<string, { n: number; dates: number[]; latency: number[] }>()
  for (const c of d.conversations) {
    const ch = c.channel || 'unknown'
    const b = byCh.get(ch) || { n: 0, dates: [], latency: [] }
    b.n++; b.dates.push(ms(c.created_at))
    const msgs = (d.messagesByConv.get(c.id) || []).slice().sort((a, z) => ms(a.timestamp) - ms(z.timestamp))
    const fu = msgs.find((m) => m.role === 'user'); const rp = msgs.find((m) => (m.role === 'assistant' || m.role === 'agent') && fu && ms(m.timestamp) >= ms(fu.timestamp))
    if (fu && rp) b.latency.push((ms(rp.timestamp) - ms(fu.timestamp)) / 60000)
    byCh.set(ch, b)
  }
  if (byCh.size === 0) return out
  const mix = [...byCh.entries()].map(([k, v]) => [k, v.n] as [string, number]).sort((a, b) => b[1] - a[1])
  const top = mix[0]
  out.push(mk('channel', 'top_channel', 'Primary channel',
    `Most customers reach you on ${top[0]} (${top[1]} conversation(s)).`, top[1], 'conversations', top[1],
    { mix: Object.fromEntries(mix) }, byCh.get(top[0])!.dates, 0.4))
  const withLat = [...byCh.entries()].filter(([, v]) => v.latency.length >= 3)
    .map(([k, v]) => [k, v.latency.reduce((a, b) => a + b, 0) / v.latency.length] as [string, number])
    .sort((a, b) => a[1] - b[1])
  if (withLat.length >= 2) out.push(mk('channel', 'fastest_channel', 'Fastest channel',
    `You respond fastest on ${withLat[0][0]} (~${Math.round(withLat[0][1])} min).`, Math.round(withLat[0][1]), 'minutes',
    byCh.get(withLat[0][0])!.n, { fastest: withLat[0][0] }, byCh.get(withLat[0][0])!.dates, 0.35))
  return out
}

export function detectPatterns(d: BrainData): Pattern[] {
  return [...responseTime(d), ...questions(d), ...booking(d), ...payment(d), ...missed(d), ...channel(d)]
}

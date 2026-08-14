// THE AUTONOMY RULE — what Miles may send, and what he may only draft.
//
// Not a global toggle. The split is by what the reply COMMITS THE BUSINESS TO:
//
//   sends immediately          drafts and waits
//   ─────────────────          ────────────────
//   hours, location            any price or quote
//   availability               any date or delivery commitment
//   facts in the knowledge     complaints, refunds, compensation
//   base                       anything with no answer in the knowledge base
//   booking inside an
//   existing availability
//   window
//
// ── WHY IT READS THE DRAFT AND NOT THE QUESTION ─────────────────────────────────────────────────────
//
// "What are your hours?" is on the left of that table, and a reply to it that says "we're open till
// six, and we could do it for £200" is not. What goes out in the owner's name is the reply, so the
// reply is what gets classified. The inbound is read too, but only for grievance: a customer opening
// with "this arrived broken" is a complaint no matter how measured the answer is.
//
// ── WHY IT IS NOT A MODEL CALL ──────────────────────────────────────────────────────────────────────
//
// This decides whether something is said in a person's name without asking them. It has to be
// inspectable, reproducible, and testable against exact strings — a judgement that varies run to run
// cannot be argued with by the person it speaks for. So: patterns, and every hold carries the exact
// text that caused it.
//
// ── THE BIAS IS DELIBERATE ──────────────────────────────────────────────────────────────────────────
//
// Every ambiguity resolves toward HOLDING. Holding a reply that could have been sent costs a person
// ten seconds; sending a price nobody agreed to cannot be taken back. `grounded` has no default for
// the same reason — the caller has to state it, rather than inherit a convenient assumption.

export type CommitmentKind = 'price' | 'schedule' | 'grievance' | 'ungrounded' | 'rule'

export interface Commitment {
  kind: CommitmentKind
  /** The exact text that caused it. The owner sees this; "held because of something" is not a reason. */
  evidence: string
  /** Where it was found. A complaint is the customer's words, a price is usually Miles's. */
  source: 'reply' | 'inbound' | 'rule'
}

/** How the owner adjusts the rule — by telling Miles, never by filling in a form. */
export interface AutonomyRule {
  id: string
  kind: CommitmentKind | 'all'
  action: 'hold' | 'send'
  /** What the owner actually said, so it can be read back in their words. */
  phrase: string
  created_at?: string
}

export interface AutonomyInput {
  /** The reply Miles wrote, exactly as it would send. */
  reply: string
  /** What the customer said. */
  inbound: string
  /**
   * Did this answer come from something the business has actually told us — knowledge base, catalog,
   * business hours? No default: "anything with no answer in the knowledge base" is half the rule, and
   * a caller that has not worked it out must not get a silent `true`.
   */
  grounded: boolean
  /** The reply books inside an availability window that already exists, so its date is not a new promise. */
  bookingWithinAvailability?: boolean
  /** The owner's spoken adjustments, from ai_employees.autonomy_rules. */
  rules?: AutonomyRule[]
}

export interface AutonomyDecision {
  verdict: 'send' | 'hold'
  commitments: Commitment[]
  /** One plain line for the inbox row and the notification. */
  summary: string
}

// ── DETECTORS ───────────────────────────────────────────────────────────────────────────────────────
//
// English and Spanish, because the phone path already speaks both (voiceLangConfig) and a rule that
// only holds English prices is not a rule.

const PRICE = [
  // A figure with a currency, either side: "$1,200", "1200 dollars", "£45.50", "₪300"
  /[$€£₪]\s?\d/,
  /\b\d[\d,.]*\s?(dollars?|usd|eur|euros?|pounds?|gbp|shekels?|nis|pesos?)\b/i,
  /\b(price|priced|pricing|cost|costs|quote|quoted|quotation|estimate|fee|fees|charge|charges|rate|rates|deposit|invoice)\b/i,
  /\bthe total\b|\btotal (is|comes to|of)\b/i,
  /\b(per|an|a)\s?(hour|hr|day|item|piece|unit)\b/i,
  /\b\d+\s?%\s?(off|discount)?/i,
  // "free" only where it is about money. "feel free to ask" is in half of these replies and is not a
  // price — a detector that holds on it would train the owner to stop reading the reasons.
  /\b(discount|for free|free of charge|no charge|at no cost|complimentary|on the house)\b/i,
  /\bit'?s free\b/i,
  // Spanish
  /\b(precio|precios|cuesta|costo|coste|cotizaci[óo]n|presupuesto|tarifa|dep[óo]sito|gratis|descuento)\b/i,
]

// ── DATES ARE NOT PROMISES ──────────────────────────────────────────────────────────────────────────
//
// "We're open Monday to Friday, 9am to 5pm" is the first row of the sends-immediately column, and it
// is full of dates and times. "We'll have it ready Monday" is the same words and a commitment. What
// separates them is not the date — it is who is undertaking to do something.
//
// So a date alone is never a hold. A date PLUS a first-person undertaking is, and a lead time is one
// on its own because "ready by Friday" needs no pronoun to be a promise.

const TIME_TOKENS = [
  /\b(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)\b/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b(today|tonight|tomorrow|this (week|afternoon|evening|morning)|next (week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
  /\b\d{1,2}\s?(am|pm)\b/i,
  /\b\d{1,2}:\d{2}\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/,
  // Spanish
  /\b(hoy|ma[ñn]ana|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)\b/i,
]

/** Someone undertaking to do something. First person, or a booking being fixed. */
const UNDERTAKING = [
  /\b(we'?ll|we will|i'?ll|i will|we can|i can|we could|i could|we'?re able to)\b/i,
  /\b(you'?ll (have|get|receive)|it'?ll be|it will be|we'?ve booked|i'?ve booked)\b/i,
  /\b(confirmed for|booked (you )?(in )?for|scheduled for|pencil(ed)? (you )?in|see you (on|at))\b/i,
  /\b(we'?ll be there|come out|on site|drop it off|pick it up)\b/i,
  // Spanish
  /\b(podemos|puedo|estar[áa] listo|te confirmo|confirmado para)\b/i,
]

/** A promise that needs no pronoun. */
const LEAD_TIME = [
  /\b(ready by|ready on|will be ready|be ready by|turnaround|lead time)\b/i,
  /\bwithin \d+\s?(minutes?|hours?|days?|weeks?)\b/i,
  /\b(same day|next day|by the end of (the )?(day|week))\b/i,
  /\b(deliver(ed|y)? (by|on)|arrives? (by|on)|ships? (by|on)|dispatch(ed)? (by|on))\b/i,
  // Spanish
  /\b(entrega (el|en)|listo para (el|ma[ñn]ana))\b/i,
]

// Complaints rarely use the word "complaint". A probe of ordinary phrasings caught this file sending
// a reply to "this is taking forever, I ordered 3 weeks ago" — a complaint with none of the obvious
// vocabulary in it. These patterns exist because that one got through.
const GRIEVANCE = [
  /\b(refund|refunded|money back|reimburse|reimbursement|compensation|compensate|credit note)\b/i,
  /\b(complaint|complain|complaining|unacceptable|disappointed|disappointing|unhappy|furious|appalled)\b/i,
  /\b(damaged|broken|faulty|defective|scratched|cracked|wrong (item|order|size|colour|color))\b/i,
  // The verb forms: "the clasp broke", "the strap snapped". Only the past tense — "break" and "snap"
  // in the present are ordinary words in a jewellery or repair conversation.
  /\b(broke|snapped|came apart|fell (off|apart)|stopped working|doesn'?t work|not working)\b/i,
  /\b(never (arrived|came|showed)|didn'?t (arrive|come|show)|still (waiting|haven'?t|not received)|hasn'?t arrived)\b/i,
  /\b(taking (forever|ages|too long)|where'?s my|where is my|no one (has|got back|replied)|nobody (has|got back|replied))\b/i,
  /\b(not happy|frustrated|fed up|ridiculous|poor service|terrible|awful|worst)\b/i,
  /\b(order(ed)?|paid|bought)\b.{0,30}\b\d+\s?(minutes?|hours?|days?|weeks?|months?) ago\b/i,
  /\b(chargeback|dispute|lawyer|solicitor|legal action|trading standards|small claims)\b/i,
  // Spanish
  /\b(reembolso|devoluci[óo]n|queja|da[ñn]ado|roto|defectuoso|no lleg[óo]|sigo esperando)\b/i,
]

/** The matched text itself, so the reason can quote it. */
function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[0].trim()
  }
  return null
}

const LABEL: Record<CommitmentKind, string> = {
  price: 'Quotes a price',
  schedule: 'Commits to a date',
  grievance: 'A complaint, refund or compensation',
  ungrounded: 'No answer in the knowledge base',
  rule: 'You asked to see these first',
}

/** The line a person reads on the row. Never "held": they can see that. WHY it is held. */
function summarise(commitments: Commitment[]): string {
  if (commitments.length === 0) return 'Nothing here commits you to anything.'
  const seen: string[] = []
  for (const c of commitments) if (!seen.includes(LABEL[c.kind])) seen.push(LABEL[c.kind])
  if (seen.length === 1) return seen[0]
  return `${seen.slice(0, -1).join(', ')} · ${seen[seen.length - 1]}`
}

export function classifyReply(input: AutonomyInput): AutonomyDecision {
  const reply = (input.reply ?? '').trim()
  const inbound = (input.inbound ?? '').trim()
  const rules = input.rules ?? []

  // An empty draft is not something to send. It is also not something to show as a held reply, but
  // that is the caller's problem — from here it is simply never sendable.
  if (!reply) {
    const c: Commitment[] = [{ kind: 'ungrounded', evidence: '(empty draft)', source: 'reply' }]
    return { verdict: 'hold', commitments: c, summary: summarise(c) }
  }

  const commitments: Commitment[] = []

  const price = firstMatch(reply, PRICE)
  if (price) commitments.push({ kind: 'price', evidence: price, source: 'reply' })

  // A lead time is a promise on its own; a date is one only when someone is undertaking to meet it.
  //
  // The exception the rule grants: a booking made INTO a window the owner already published is not a
  // new commitment, it is the calendar the owner set. Granted only by the booking tools knowing the
  // slot exists — never by the text looking like a booking, which is what an invented date looks like
  // too.
  const leadTime = firstMatch(reply, LEAD_TIME)
  const undertaking = firstMatch(reply, UNDERTAKING)
  const when = firstMatch(reply, TIME_TOKENS)
  const schedule = leadTime ?? (undertaking && when ? `${undertaking} … ${when}` : null)
  if (schedule && !input.bookingWithinAvailability) {
    commitments.push({ kind: 'schedule', evidence: schedule, source: 'reply' })
  }

  // Grievance is read from BOTH sides: the customer raising it is what makes the thread a complaint,
  // and a reply that offers a refund is one whatever prompted it.
  const grievanceIn = firstMatch(inbound, GRIEVANCE)
  if (grievanceIn) commitments.push({ kind: 'grievance', evidence: grievanceIn, source: 'inbound' })
  const grievanceOut = firstMatch(reply, GRIEVANCE)
  if (grievanceOut) commitments.push({ kind: 'grievance', evidence: grievanceOut, source: 'reply' })

  if (!input.grounded) {
    commitments.push({ kind: 'ungrounded', evidence: '(not answered from what the business has told us)', source: 'reply' })
  }

  // ── THE OWNER'S OWN RULES ─────────────────────────────────────────────────────────────────────────
  //
  // Applied last, over the defaults. A 'send' rule can only REMOVE a commitment the defaults found —
  // it is the owner saying "you may answer that kind yourself" — and a 'hold' rule adds one. Neither
  // can invent a commitment out of a kind nothing detected, except 'all', which is the owner asking to
  // see everything.
  let out = [...commitments]

  for (const r of rules) {
    if (r.action !== 'send') continue
    out = out.filter((c) => {
      // An ungrounded answer is never a matter of permission. The business has not told us the
      // answer, so there is nothing for the owner to authorise — "you can answer that yourself" and
      // "make something up" are different sentences.
      if (c.kind === 'ungrounded') return true
      return r.kind !== 'all' && c.kind !== r.kind
    })
  }

  for (const r of rules) {
    if (r.action !== 'hold') continue
    // 'all' is the owner asking to see everything. Any other kind only fires when the defaults
    // actually found that kind — a rule cannot invent a commitment that is not in the text.
    if (r.kind === 'all' || commitments.some((c) => c.kind === r.kind)) {
      out.push({ kind: 'rule', evidence: r.phrase, source: 'rule' })
    }
  }

  return {
    verdict: out.length > 0 ? 'hold' : 'send',
    commitments: out,
    summary: summarise(out),
  }
}

/** How long it has waited, in the words the draft box uses: "Held since 9:41." */
export function heldSince(createdAt: string, now: Date = new Date()): string {
  const then = new Date(createdAt)
  if (Number.isNaN(then.getTime())) return ''
  const mins = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

// Rudi's caption. A pure function of the real numbers — no model call, no fetch, no clock beyond what
// is handed in.
//
// The reference's caption is one sentence of state plus one bolded clause that carries the point:
//
//   "Two calls came in while you were out. Both booked. <b>Nothing needs you right now.</b>"
//
// That shape is the design. What this file must not do is invent the content: every clause below is
// derived from a figure that actually exists, and when a figure is zero the clause is omitted rather
// than padded. The bolded clause is chosen last, from whatever the numbers actually say.
//
// Returns segments rather than an HTML string so the component renders <b> as an element and nothing
// has to be dangerously set.

export interface RudiLineInput {
  /** Appointments whose slot_date is today. */
  jobsToday: number
  /** Leads in status new/contacted — the ones nobody has answered. */
  unansweredLeads: number
  /** Conversations where a human was asked for. */
  humanRequested: number
}

export type RudiSegment = { text: string; accent?: boolean }

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * The idle caption.
 *
 * Ordered by what an owner would want first: what is happening today, then what is waiting on them.
 * The accented clause is the conclusion, and it is the only part that changes tone — "nothing needs
 * you" when both queues are empty, otherwise the count of things that do.
 */
export function rudiLine(input: RudiLineInput): RudiSegment[] {
  const { jobsToday, unansweredLeads, humanRequested } = input
  const waiting = unansweredLeads + humanRequested
  const segments: RudiSegment[] = []

  if (jobsToday > 0) {
    segments.push({ text: `${jobsToday} ${plural(jobsToday, 'job', 'jobs')} on the books today. ` })
  }

  if (waiting === 0) {
    // Both queues empty. This is the reference's own resting state.
    if (jobsToday === 0) segments.push({ text: 'Quiet so far today. ' })
    segments.push({ text: 'Nothing needs you right now.', accent: true })
    return segments
  }

  // Something is waiting. Name the parts that are non-zero, then bold the total as the conclusion.
  const parts: string[] = []
  if (unansweredLeads > 0) {
    parts.push(`${unansweredLeads} ${plural(unansweredLeads, 'lead has', 'leads have')} not been answered`)
  }
  if (humanRequested > 0) {
    parts.push(`${humanRequested} ${plural(humanRequested, 'caller asked', 'callers asked')} for a person`)
  }
  segments.push({ text: `${parts.join(' and ')}. ` })
  segments.push({
    text: waiting === 1 ? 'One thing needs you.' : `${waiting} things need you.`,
    accent: true,
  })
  return segments
}

/** The button's label. Armed says whose turn it is, because that is the only thing worth saying. */
export function rudiState(state: 'idle' | 'listening' | 'speaking' | 'armed'): string {
  if (state === 'listening') return 'Listening'
  if (state === 'speaking') return 'Rudi is speaking'
  if (state === 'armed') return 'Your turn'
  return 'Talk to Rudi'
}

// ── The reply ───────────────────────────────────────────────────────────────────────────────────────
//
// A PURE function of the numbers already on the page. No model call, no request, no invention: every
// branch answers from a figure the screen is already showing, and the fallback says what it knows
// rather than pretending to have understood.
//
// Matching is keyword-based and deliberately shallow. The point of this screen is the loop — voice in,
// meter, transcript, answer, voice out — not language understanding, and a shallow matcher that is
// honest about its range beats a clever one that guesses.

export interface ReplyFacts extends RudiLineInput {
  monthLabel: string
  conversationsManaged: number
  customersHelped: number
  /** Null when the tenant has no coverage figure — the sentence omits it rather than saying 0%. */
  answeredPct: number | null
}

export function rudiReply(said: string, f: ReplyFacts): string {
  const q = said.toLowerCase()
  const has = (...words: string[]) => words.some((w) => q.includes(w))

  if (has('lead', 'unanswered', 'waiting')) {
    return f.unansweredLeads === 0
      ? 'No leads are waiting. Everything that came in has been answered.'
      : `${f.unansweredLeads} ${f.unansweredLeads === 1 ? 'lead is' : 'leads are'} waiting for an answer.`
  }

  if (has('today', 'job', 'appointment', 'booked', 'schedule', 'diary')) {
    return f.jobsToday === 0
      ? 'Nothing is booked for today.'
      : `${f.jobsToday} ${f.jobsToday === 1 ? 'job is' : 'jobs are'} on the books for today.`
  }

  if (has('month', 'how are we', 'doing', 'busy', 'volume', 'conversation')) {
    const answered = f.answeredPct === null ? '' : `, and ${Math.round(f.answeredPct)} percent were answered`
    return `In ${f.monthLabel} I handled ${f.conversationsManaged} conversations and helped ${f.customersHelped} customers${answered}.`
  }

  if (has('call me', 'person', 'human', 'handover', 'takeover')) {
    return f.humanRequested === 0
      ? 'Nobody has asked for a person.'
      : `${f.humanRequested} ${f.humanRequested === 1 ? 'caller has' : 'callers have'} asked for a person.`
  }

  if (has('anything', 'need', 'attention', 'what should', 'urgent')) {
    const waiting = f.unansweredLeads + f.humanRequested
    return waiting === 0
      ? 'Nothing needs you right now.'
      : `${waiting} ${waiting === 1 ? 'thing needs' : 'things need'} you: ${f.unansweredLeads} unanswered and ${f.humanRequested} asking for a person.`
  }

  // Understood nothing. Say so, and offer what IS known rather than filling the silence.
  const waiting = f.unansweredLeads + f.humanRequested
  return waiting === 0
    ? `I can tell you about today's jobs, waiting leads, or how ${f.monthLabel} is going. Right now nothing needs you.`
    : `I can tell you about today's jobs, waiting leads, or how ${f.monthLabel} is going. Right now ${waiting} ${waiting === 1 ? 'thing needs' : 'things need'} you.`
}

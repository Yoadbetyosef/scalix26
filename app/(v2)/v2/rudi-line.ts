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
  /** People whose first ever conversation was today — someone genuinely new. */
  newToday: number
  /** How many of those the employees dealt with, nothing outstanding. */
  newHandled: number
  /** Threads needing a person right now: held drafts plus unanswered customers. */
  waiting: number
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
  const { jobsToday, newToday, newHandled, waiting } = input
  const segments: RudiSegment[] = []

  if (jobsToday > 0) {
    segments.push({ text: `${jobsToday} ${plural(jobsToday, 'job', 'jobs')} on the books today. ` })
  }

  // WHO ARRIVED — said before what is waiting, because it is the good half and it is the half the
  // owner never used to be told. "3 new people today" is a fact about the business; the old opening
  // clause was a fact about a status column, and a wrong one.
  if (newToday > 0) {
    const who = `${newToday} new ${plural(newToday, 'person', 'people')} today`
    if (newHandled === newToday) {
      segments.push({ text: `${who} — all handled. ` })
    } else if (newHandled > 0) {
      segments.push({ text: `${who}, ${newHandled} handled. ` })
    } else {
      segments.push({ text: `${who}. ` })
    }
  }

  if (waiting === 0) {
    // Nothing outstanding. The reference's own resting state.
    if (jobsToday === 0 && newToday === 0) segments.push({ text: 'Quiet so far today. ' })
    segments.push({ text: 'Nothing needs you right now.', accent: true })
    return segments
  }

  // Something IS outstanding. Never phrased as "not answered" unless it genuinely has not been:
  // `waiting` is the inbox's own two groups, so a thread an employee dealt with is never in it.
  segments.push({
    text: waiting === 1 ? 'One thing needs you.' : `${waiting} things need you.`,
    accent: true,
  })
  return segments
}

// ── EVERY LABEL ON THIS SCREEN COMES FROM HERE ──────────────────────────────────────────────────────
//
// There were two vocabularies: the button called rudiState(), and the cursor had its own inline
// ternary that only knew idle from not-idle. Both read the same `state`, through two mappings written
// in two places — so armed fell into the cursor's "not idle" branch and the screen said "Your turn"
// and "STOP" at the same moment about the same state.
//
// Nothing was stale. Two derivations of one value drifted, which is the failure OUTSTANDING.md §7j
// describes: when two things must agree, make them one thing. One state in, both labels out.

export type LabelState = 'idle' | 'listening' | 'speaking' | 'armed'

/** The button's label. It names the STATE — whose turn it is, and what is happening. */
export function rudiState(state: LabelState): string {
  if (state === 'listening') return 'Listening'
  if (state === 'speaking') return 'Rudi is speaking'
  if (state === 'armed') return 'Your turn'
  return 'Talk to Rudi'
}

/**
 * The cursor's label. It names the ACTION a click performs, which is a different sentence about the
 * same state — and must never contradict it.
 *
 * Every non-idle click calls endSession(), so every non-idle state says the same word. "STOP" was
 * wrong for armed in particular: nothing is running to stop, it is waiting for you.
 */
export function rudiCursor(state: LabelState, minimised: boolean): string {
  if (minimised) return 'EXPAND'
  return state === 'idle' ? 'TALK' : 'END'
}

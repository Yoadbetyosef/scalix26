import type { RudiSegment } from '../rudi-line'

// Same discipline as rudi-line.ts: figures that exist, no clause invented to fill a zero, and the
// accent is whatever needs a person.
//
// The first version accented a phone number — "+12128381400 was last, 3 d ago" — which is not an
// action and was the brightest thing on the screen. Emphasis belongs on what needs the owner, and when
// nothing does the line is all white, which is the correct and common answer.
//
// It also wrote "3 d ago" in a sentence. That abbreviation belongs in the mono column beside a row,
// not in prose.

export interface InboxLineInput {
  total: number
  calls: number
  /** Conversations that are not resolved or closed. */
  openCount: number
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export function inboxLine({ total, calls, openCount }: InboxLineInput): RudiSegment[] {
  if (total === 0) return [{ text: 'Nothing has come in yet.', accent: true }]

  const segments: RudiSegment[] = []
  segments.push({ text: `${total} recent ${plural(total, 'conversation', 'conversations')}` })
  segments.push({ text: calls > 0 ? `, ${calls} of them ${plural(calls, 'a call', 'calls')}. ` : '. ' })

  segments.push(
    openCount > 0
      ? { text: `${openCount} ${plural(openCount, 'is', 'are')} still open.`, accent: true }
      : { text: 'Every one of them is settled.', accent: true },
  )
  return segments
}

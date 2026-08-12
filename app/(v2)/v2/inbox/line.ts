import type { RudiSegment } from '../rudi-line'

// Same discipline as rudi-line.ts and leads/line.ts: figures that exist, no clause invented to fill a
// zero, and the accent is the conclusion — here, who spoke most recently, because that is the thread an
// owner opens first.

export interface InboxLineInput {
  total: number
  calls: number
  newest: { name: string; when: string } | null
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export function inboxLine({ total, calls, newest }: InboxLineInput): RudiSegment[] {
  if (total === 0) return [{ text: 'Nothing has come in yet.', accent: true }]

  const segments: RudiSegment[] = []
  segments.push({ text: `${total} recent ${plural(total, 'conversation', 'conversations')}` })
  segments.push({ text: calls > 0 ? `, ${calls} of them ${plural(calls, 'a call', 'calls')}. ` : '. ' })
  segments.push(
    newest
      ? { text: `${newest.name} was last${newest.when ? `, ${newest.when}` : ''}.`, accent: true }
      : { text: 'Nothing needs you.', accent: true },
  )
  return segments
}

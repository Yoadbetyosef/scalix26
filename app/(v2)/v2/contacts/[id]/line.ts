import type { RudiSegment } from '../../rudi-line'

export interface ContactProfileLineInput {
  name: string | null
  conversations: number
  lastHeard: string | null
  notes: string | null
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// What an owner opens a contact to remember: how much history there is, and when it last moved. The
// accent is the recency, because that is what decides whether to call them.
export function contactProfileLine({ name, conversations, lastHeard }: ContactProfileLineInput): RudiSegment[] {
  const who = name || 'They'
  if (conversations === 0) {
    return [{ text: `${who} ${name ? 'is' : 'are'} in the book. ` }, { text: 'Rudi has not spoken to them yet.', accent: true }]
  }
  const segments: RudiSegment[] = [
    { text: `${conversations} ${plural(conversations, 'conversation', 'conversations')} with ${name || 'them'}. ` },
  ]
  segments.push(
    lastHeard
      ? { text: `Last heard from ${lastHeard.toLowerCase()}.`, accent: true }
      : { text: 'No recent activity.', accent: true },
  )
  return segments
}

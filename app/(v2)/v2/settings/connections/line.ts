import type { RudiSegment } from '../../rudi-line'

export interface ConnectionsLineInput {
  live: number
  review: number
  /** Capabilities with nothing connected at all — the ones Rudi genuinely cannot do. */
  blocked: string[]
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// The accent is what Rudi cannot do yet, named as a capability rather than as a count of switches —
// "Rudi can't book anything yet" is a fact about the business; "2 integrations missing" is a fact
// about a settings page. Where nothing is blocked it says so, and that reads like the goal state it is.
export function connectionsLine({ live, review, blocked }: ConnectionsLineInput): RudiSegment[] {
  const segments: RudiSegment[] = []

  if (live > 0) segments.push({ text: `${live} ${plural(live, 'connection', 'connections')} live` })
  else segments.push({ text: 'Nothing is connected yet' })
  // In review is worth saying out loud precisely because there is nothing to do about it.
  segments.push({ text: review > 0 ? `, ${review} in review. ` : '. ' })

  if (blocked.length === 0) {
    segments.push({ text: 'Rudi can do everything you have set up.', accent: true })
    return segments
  }
  const list = blocked.length === 1
    ? blocked[0]
    : `${blocked.slice(0, -1).join(', ')} or ${blocked[blocked.length - 1]}`
  segments.push({ text: `Until you connect something, Rudi can't ${list}.`, accent: true })
  return segments
}

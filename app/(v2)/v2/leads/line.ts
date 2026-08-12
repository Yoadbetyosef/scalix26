import type { RudiSegment } from '../rudi-line'

// The Leads opening line. Same discipline as rudi-line.ts: a pure function of figures that exist, the
// accented clause chosen last from whatever the numbers actually say, and a clause omitted rather than
// padded when its figure is zero.
//
// The reference's sentence names a person — "Marcus Webb is still waiting on a callback" — and that is
// the part worth reproducing, because a count tells an owner there is work and a name tells them which
// work. So the accent is the oldest lead nobody has answered. When there is no such lead the line says
// so instead of inventing one; "nothing is waiting" is a true and useful sentence, and it is the only
// honest alternative to naming someone.

export interface LeadsLineInput {
  newCount: number
  openCount: number
  bookedCount: number
  /** The oldest lead still in new/contacted, with how long it has waited. Null when none are. */
  oldestWaiting: { name: string; waited: string } | null
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export function leadsLine(input: LeadsLineInput): RudiSegment[] {
  const { newCount, openCount, bookedCount, oldestWaiting } = input
  const segments: RudiSegment[] = []

  const parts: string[] = []
  if (newCount > 0) parts.push(`${newCount} new`)
  if (openCount > 0) parts.push(`${openCount} open`)
  if (parts.length) {
    segments.push({ text: `${parts.join(' and ')}. ` })
  } else if (bookedCount > 0) {
    segments.push({ text: `${bookedCount} ${plural(bookedCount, 'lead', 'leads')} booked. ` })
  }

  if (oldestWaiting) {
    segments.push({ text: `${oldestWaiting.name} has been waiting ${oldestWaiting.waited}.`, accent: true })
    return segments
  }

  // Nobody is waiting. Say which of the two reasons that is, because they are different facts: every
  // lead settled, or no leads at all.
  segments.push({
    text: bookedCount > 0 || newCount > 0 || openCount > 0
      ? 'Nobody is waiting on you.'
      : 'No leads yet.',
    accent: true,
  })
  return segments
}

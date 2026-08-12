import type { RudiSegment } from '../rudi-line'

export interface AppointmentsLineInput {
  today: number
  later: number
  /** The next job on the books, whether it is today or after. */
  next: { primary: string; trailing?: string | null } | null
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// The accent names the next job rather than counting them: a count says there is work, a name says
// which. When the book is empty it says so instead of finding something.
export function appointmentsLine({ today, later, next }: AppointmentsLineInput): RudiSegment[] {
  const segments: RudiSegment[] = []
  if (today > 0) segments.push({ text: `${today} on the books today. ` })
  else if (later > 0) segments.push({ text: `Nothing today. ${later} ${plural(later, 'job', 'jobs')} coming up. ` })

  if (!next) {
    segments.push({ text: today + later === 0 ? 'Nothing booked.' : 'Nothing else needs you.', accent: true })
    return segments
  }
  segments.push({ text: `Next is ${next.primary}${next.trailing ? `, ${next.trailing}` : ''}.`, accent: true })
  return segments
}

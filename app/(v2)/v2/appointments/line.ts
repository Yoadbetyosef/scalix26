import type { RudiSegment } from '../rudi-line'

// The opening line, in the caption's own segment form so the accent renders as an element.
//
// Same rule as every other opening line in /v2: every clause is a figure that exists, a zero clause
// is omitted rather than padded, and the accent is the CONCLUSION — the one thing worth acting on.
// The reference's own line is "4 booked today. One is missing an address."

export interface AgendaLineInput {
  todayCount: number
  laterCount: number
  missingCount: number
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export function agendaLine({ todayCount, laterCount, missingCount }: AgendaLineInput): RudiSegment[] {
  const segs: RudiSegment[] = []

  if (todayCount > 0) segs.push({ text: `${todayCount} booked today. ` })
  else if (laterCount > 0) segs.push({ text: `Nothing today. ${laterCount} coming up. ` })

  if (missingCount > 0) {
    // The accent, because it is the only thing on this screen that needs a person.
    segs.push({
      text: missingCount === 1
        ? 'One is missing something.'
        : `${missingCount} are missing something.`,
      accent: true,
    })
    return segs
  }

  if (todayCount === 0 && laterCount === 0) return [{ text: 'Nothing booked yet.', accent: true }]
  segs.push({ text: `${plural(todayCount + laterCount, 'It is', 'They are')} all set.`, accent: true })
  return segs
}

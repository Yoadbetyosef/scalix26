import type { RudiSegment } from '../rudi-line'

export interface AnalyticsLineInput {
  total: number
  resolved: number
  fcr: number
  /** The channel that carried the most conversations, when there is one. */
  busiest: string | null
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// What the month actually did, in a sentence. The accent is the share Rudi settled without a person,
// because that is the number this screen exists to report — and when there were no conversations at
// all it says so rather than accenting a zero.
export function analyticsLine({ total, resolved, fcr, busiest }: AnalyticsLineInput): RudiSegment[] {
  if (total === 0) return [{ text: 'Nothing has come through in the last 30 days.', accent: true }]

  const segments: RudiSegment[] = [
    { text: `${total} ${plural(total, 'conversation', 'conversations')} in the last 30 days${busiest ? `, mostly ${busiest}` : ''}. ` },
  ]
  segments.push({
    text: resolved === 0
      ? 'None of them were settled without a person.'
      : `Rudi settled ${resolved} of them without you — ${fcr}%.`,
    accent: true,
  })
  return segments
}

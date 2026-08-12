import type { RudiSegment } from '../rudi-line'

export interface ContactsLineInput {
  /** Everyone in the book. */
  total: number
  /** How many are on this page — the read is a window, not the whole book. */
  shown: number
  spoken: number
  newest: { primary: string; trailing?: string | null } | null
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// The accent names who was spoken to most recently. The count says the book is large; a name says
// something happened. It never claims the page is the whole book — an imported address book is far
// bigger than a screenful and saying "312 people" under 50 rows would be a quiet lie.
export function contactsLine({ total, shown, spoken, newest }: ContactsLineInput): RudiSegment[] {
  if (total === 0) return [{ text: 'Nobody in the book yet.', accent: true }]

  const segments: RudiSegment[] = []
  segments.push({ text: `${total} ${plural(total, 'person', 'people')} in the book` })
  segments.push({ text: shown < total ? `, showing ${shown}. ` : '. ' })
  if (!newest) {
    segments.push({
      text: spoken > 0 ? `${spoken} ${plural(spoken, 'has', 'have')} spoken to Rudi.` : 'None of them have been in touch yet.',
      accent: true,
    })
    return segments
  }
  segments.push({ text: `${newest.primary} was the most recent${newest.trailing ? `, ${newest.trailing}` : ''}.`, accent: true })
  return segments
}

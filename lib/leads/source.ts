import type { LeadSource } from '@/types'

// WHERE A PERSON CAME FROM.
//
// The one fact the leads screen carried that lives nowhere else — not on the conversation, not on the
// contact, not in the inbox. The screen is going; the fact is not, so it moves to the conversation
// sidebar beside Channel, which answers the neighbouring question (how they are talking to you) and
// never this one (how they found you).
//
// Verbatim from components/dashboard/leads-table.tsx, which is where they were written and where
// they were about to be deleted with it.
export const SOURCE_LABEL: Record<LeadSource, string> = {
  missed_call: 'Missed call',
  voice_call: 'Phone call',
  web_form: 'Web form',
  google_lsa: 'Google LSA',
  facebook: 'Facebook',
  yelp: 'Yelp',
  angi: 'Angi',
  other: 'Other',
}

/** A source the table allows but this map has not been taught reads as itself, never as a guess. */
export const sourceLabel = (s: string | null | undefined): string | null =>
  s ? (SOURCE_LABEL[s as LeadSource] ?? s) : null

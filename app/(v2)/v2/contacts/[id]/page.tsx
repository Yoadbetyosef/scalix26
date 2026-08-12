import { notFound } from 'next/navigation'
import { readContactProfile } from '@/lib/contacts/profile-read'
import { DetailPage, type DetailFact, type DetailRow } from '../../detail'
import { listPageContext, relativeTime, PREVIEW } from '../../list-page'
import { contactProfileLine } from './line'

// One contact, reskinned. readContactProfile is the /contacts/[id] page's own read, extracted
// verbatim — same queries, same columns, same ordering. No new query. READ-ONLY.

export const dynamic = 'force-dynamic'

// An empty string is not a value: it renders as a blank fact, which reads as a bug rather than as
// "we do not have this". Both collapse to null so DetailPage draws its em dash.
const str = (v: string | null | undefined) => (v && v.trim() ? v : null)

export default async function V2ContactDetail({ params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await listPageContext('contacts')
  const profile = await readContactProfile(tenantId, (await params).id)
  if (!profile) notFound()
  const { contact, conversations } = profile

  // Same rule as the list (CT2): identify them by whatever we actually have rather than by "Unknown".
  const title = str(contact.name) || str(contact.email) || str(contact.phone) || 'Unknown contact'
  const last = str(contact.last_interaction)

  const facts: DetailFact[] = [
    { label: 'Phone', value: str(contact.phone) },
    { label: 'Email', value: str(contact.email) },
    { label: 'Address', value: str(contact.address) },
    { label: 'Channel', value: str(contact.channel) },
    { label: 'Language', value: str(contact.language) },
    { label: 'First seen', value: str(contact.created_at)?.slice(0, 10) ?? null },
    { label: 'Last heard from', value: last ? relativeTime(last) : null },
    { label: 'Conversations', value: String(Number(contact.total_conversations ?? 0)) },
  ]

  const rows: DetailRow[] = conversations.map((c) => ({
    id: c.id,
    primary: [c.channel, c.status].filter(Boolean).join(' · ') || 'Conversation',
    detail: c.summary,
    trailing: relativeTime(c.updated_at),
  }))

  return (
    <DetailPage
      backHref="/v2/contacts"
      backLabel="Contacts"
      eyebrow={str(contact.phone) ?? str(contact.email)}
      title={title}
      chips={str(contact.channel) ? [{ label: str(contact.channel)! }] : []}
      line={contactProfileLine({
        name: str(contact.name),
        conversations: conversations.length,
        lastHeard: last ? relativeTime(last) : null,
        notes: str(contact.notes),
      })}
      actions={[
        ...(str(contact.phone) ? [{ label: 'Call', tone: 'primary' as const, disabledReason: PREVIEW }] : []),
        ...(str(contact.email) ? [{ label: 'Email', disabledReason: PREVIEW }] : []),
        { label: 'Edit', disabledReason: PREVIEW },
      ]}
      sections={[
        { title: 'Details', facts },
        ...(str(contact.notes) ? [{ title: 'Notes', facts: [{ label: 'Note', value: str(contact.notes) }] }] : []),
        { title: 'Conversations', rows, empty: 'Rudi has not spoken to them yet.' },
      ]}
    />
  )
}

import { listContactsPage, type ContactRow } from '@/lib/contacts/page-read'
import { isSocialChannel } from '@/lib/utils'
import { ContactBody } from './[id]/body'
import { ListPage, type ListFilter, type ListRow } from '../list'
// From channels.ts, not list.tsx: this is called on the SERVER, and a client module's exports are
// proxies there. See channels.ts.
import { channelKey } from '../channels'
import { listPageContext, relativeTime, PREVIEW } from '../list-page'
import { contactsLine } from './line'

// Contacts, reskinned. listContactsPage() is the contacts page's own read, extracted verbatim to
// lib/ so both screens see the same window onto the address book — same slice, same ordering, same
// search. This page adds no query.

export const dynamic = 'force-dynamic'

// The buckets are how a contact reached the business, which is the only grouping the row data
// supports without inventing one.
const FILTERS: ListFilter[] = [
  { id: 'all', label: 'All', buckets: ['spoken', 'social', 'quiet'] },
  { id: 'spoken', label: 'Talked to', buckets: ['spoken'] },
  { id: 'social', label: 'Social', buckets: ['social'] },
  { id: 'quiet', label: 'No contact yet', buckets: ['quiet'] },
]

// Verbatim from app/contacts/page.tsx: a contact the AI created from one inbound email or call has
// nothing but that address, and calling them "Unknown" hides the one thing we DO know about them.
const displayTitle = (c: ContactRow): string => c.name || c.email || c.phone || 'Unknown'

export default async function V2Contacts({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { open } = await searchParams
  const { tenantId } = await listPageContext('contacts')
  const { contacts, total } = await listContactsPage(tenantId)

  const rows: ListRow[] = contacts.map((c) => {
    const bucket = c.total_conversations > 0 ? 'spoken' : isSocialChannel(c.channel ?? '') ? 'social' : 'quiet'
    return {
      id: c.id,
      primary: displayTitle(c),
      detail: [c.email, c.phone, c.channel].filter(Boolean).join(' · ') || 'No details yet',
      // When they were last spoken to. A contact with no interaction has no time to show, and a
      // fabricated one would be worse than a blank.
      trailing: c.last_interaction ? relativeTime(c.last_interaction) : null,
      marked: false,
      muted: bucket === 'quiet',
      href: `/v2/contacts/${c.id}`,
      bucket,
      channel: channelKey(c.channel),
      actions: [{ label: 'Open', tone: 'primary', disabledReason: PREVIEW }],
    }
  })

  // AWAITED HERE, on the server, whenever ?open is set — including on a narrow viewport, where
  // ListPage will not display it. A prop is serialised whether or not the client renders it, so the
  // work happens either way; the earlier comment claimed otherwise and was wrong. Awaiting it also
  // lets a missing record become a note in the pane instead of a throw that blanks the screen.
  const detail = open ? await ContactBody({ tenantId, id: open }) ?? <p className="v2-pnone">That contact is no longer here.</p> : null

  return (
    <ListPage
      selectedId={open ?? null}
      detail={detail}
      title="Contacts"
      line={contactsLine({
        total,
        shown: rows.length,
        spoken: rows.filter((r) => r.bucket === 'spoken').length,
        newest: rows.find((r) => r.trailing) ?? null,
      })}
      filters={FILTERS}
      initialFilter="all"
      rows={rows}
      backHref="/v2"
      empty={{ title: 'No contacts yet', body: 'Everyone Rudi speaks to is added here automatically.' }}
    />
  )
}

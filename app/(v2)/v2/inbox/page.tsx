import { getDashboardData } from '@/lib/dashboard/overview'
import { ListPage, type ListFilter, type ListRow } from '../list'
import { listPageContext, relativeTime, PREVIEW } from '../list-page'
import { inboxLine } from './line'

// Inbox, reskinned onto the shared list. Same rows the dashboard already loads — getDashboardData
// returns the ten most recently updated conversations with their contact — so this page adds no query.
// READ-ONLY: actions render and are disabled with title="v2 preview".

export const dynamic = 'force-dynamic'

// Channels group the way the reference's chips do: everything, spoken, typed.
const VOICE = ['voice', 'phone']
const FILTERS: ListFilter[] = [
  { id: 'all', label: 'All', buckets: ['voice', 'message'] },
  { id: 'calls', label: 'Calls', buckets: ['voice'] },
  { id: 'messages', label: 'Messages', buckets: ['message'] },
]

interface Conv {
  id: string; channel?: string | null; updated_at?: string | null; status?: string | null
  contact?: { name?: string | null; phone?: string | null } | null
}

export default async function V2Inbox() {
  const { tenantId } = await listPageContext('inbox')
  const { conversations } = await getDashboardData(tenantId)

  const rows: ListRow[] = (conversations as Conv[]).map((c) => {
    const spoken = VOICE.includes((c.channel || '').toLowerCase())
    const when = c.updated_at || null
    return {
      id: c.id,
      primary: c.contact?.name || c.contact?.phone || 'Someone',
      detail: [c.channel || 'message', c.status || null].filter(Boolean).join(' · '),
      trailing: when ? relativeTime(when) : null,
      // The thread is the destination the rest of the app already uses for a conversation.
      href: `/v2/inbox/${c.id}`,
      bucket: spoken ? 'voice' : 'message',
      actions: [{ label: 'Open', tone: 'primary', disabledReason: PREVIEW }],
    }
  })

  return (
    <ListPage
      title="Inbox"
      line={inboxLine({
        total: rows.length,
        calls: rows.filter((r) => r.bucket === 'voice').length,
        newest: rows[0] ? { name: rows[0].primary, when: rows[0].trailing ?? '' } : null,
      })}
      filters={FILTERS}
      initialFilter="all"
      rows={rows}
      backHref="/v2"
      empty={{ title: 'Nothing yet', body: 'Every call and message Rudi handles appears here.' }}
    />
  )
}

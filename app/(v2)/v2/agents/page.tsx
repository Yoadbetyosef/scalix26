import { readAgents } from '@/lib/agents/list-read'
import { ListPage, type ListFilter, type ListRow } from '../list'
import { channelKey, CHANNEL_LABEL } from '../channels'
import { listPageContext, relativeTime, PREVIEW } from '../list-page'
import { agentsLine } from './line'

// AI Employees, reskinned. readAgents is the /ai-employees page's own read, extracted verbatim — same
// queries, same join, same ordering. No new query. READ-ONLY.

export const dynamic = 'force-dynamic'

const FILTERS: ListFilter[] = [
  { id: 'all', label: 'All', buckets: ['on', 'off', 'unreachable'] },
  { id: 'on', label: 'On duty', buckets: ['on'] },
  { id: 'off', label: 'Paused', buckets: ['off'] },
  { id: 'unreachable', label: 'No channel', buckets: ['unreachable'] },
]

export default async function V2Agents() {
  const { tenantId } = await listPageContext()
  const { employees, emailAgentIds } = await readAgents(tenantId)

  const rows: ListRow[] = employees.map((e) => {
    const chans = (e.channels ?? []).map((c) => channelKey(c.type)).filter(Boolean)
    if (emailAgentIds.has(e.id)) chans.push('email')
    const reachable = chans.length > 0
    const bucket = !reachable ? 'unreachable' : e.status === 'active' ? 'on' : 'off'
    return {
      id: e.id,
      primary: e.name || 'Unnamed employee',
      // The channels it answers on, written out. Nothing is invented when there are none — it says so.
      detail: reachable
        ? chans.map((c) => CHANNEL_LABEL[c!]).join(' · ')
        : 'No channel connected',
      trailing: relativeTime(e.created_at),
      channel: chans[0] ?? null,
      // An employee nobody can reach is the only state here that needs a person.
      needsYou: !reachable,
      muted: bucket === 'off',
      bucket,
      href: `/ai-employees/${e.id}`,
      actions: [{ label: 'Open', tone: 'primary', disabledReason: PREVIEW }],
    }
  })

  const channels = new Set(rows.flatMap((r) => (r.channel ? [r.channel] : []))).size

  return (
    <ListPage
      title="AI Employees"
      line={agentsLine({
        total: rows.length,
        onDuty: rows.filter((r) => r.bucket === 'on').length,
        channels,
        unreachable: rows.filter((r) => r.bucket === 'unreachable').length,
      })}
      filters={FILTERS}
      initialFilter="all"
      rows={rows}
      backHref="/v2"
      empty={{ title: 'No AI employees yet', body: 'An AI employee answers your calls and messages on the channels you connect.' }}
    />
  )
}

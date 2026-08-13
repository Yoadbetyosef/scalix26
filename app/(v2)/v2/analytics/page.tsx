import { readAnalytics } from '@/lib/analytics/read'
import { DetailPage, type DetailFact, type DetailRow } from '../detail'
import { channelKey, CHANNEL_LABEL } from '../channels'
import { listPageContext } from '../list-page'
import { analyticsLine } from './line'

// Analytics, reskinned. readAnalytics is app/analytics/page.tsx's own read — the 30-day window, all
// three queries and both derivations — so this adds no query. READ-ONLY; there is nothing to act on
// here, which is why it carries no actions rather than disabled ones.

export const dynamic = 'force-dynamic'

const duration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`)

export default async function V2Analytics() {
  const { tenantId } = await listPageContext('analytics')
  const { total, resolved, fcr, avgDuration, conversations } = await readAnalytics(tenantId)

  // Counted from the same rows the figures came from, so a breakdown can never disagree with its total.
  const byChannel = new Map<string, number>()
  for (const c of conversations) {
    const k = channelKey(c.channel)
    if (k) byChannel.set(k, (byChannel.get(k) ?? 0) + 1)
  }
  const ranked = [...byChannel.entries()].sort((a, b) => b[1] - a[1])

  const channels: DetailRow[] = ranked.map(([k, n]) => ({
    id: k,
    primary: CHANNEL_LABEL[k as keyof typeof CHANNEL_LABEL],
    detail: `${Math.round((n / total) * 100)}% of the month`,
    trailing: String(n),
  }))

  // A figure that does not exist is omitted, never zeroed: with no conversations there is no average
  // handle time to report, and printing "0m 0s" would claim a measurement nobody made.
  const figures: DetailFact[] = [
    { label: 'Conversations', value: total.toLocaleString() },
    { label: 'Settled without a person', value: total > 0 ? `${fcr}%` : null },
    { label: 'Average handle time', value: avgDuration > 0 ? duration(avgDuration) : null },
    { label: 'Handed to a person', value: total > 0 ? `${total - resolved}` : null },
  ]

  return (
    <DetailPage
      backHref="/v2"
      backLabel="Home"
      title="Analytics"
      eyebrow="Last 30 days"
      line={analyticsLine({
        total,
        resolved,
        fcr,
        busiest: ranked[0] ? CHANNEL_LABEL[ranked[0][0] as keyof typeof CHANNEL_LABEL].toLowerCase() : null,
      })}
      sections={[
        { title: 'The month', facts: figures },
        { title: 'Where it came from', rows: channels, empty: 'No conversations to break down yet.' },
      ]}
    />
  )
}

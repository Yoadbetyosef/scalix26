import { getPartnerContext } from '@/lib/partner/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { PageHeader, Panel, EmptyRow } from '@/components/partner/ui'
import { Trophy } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function LeaderboardPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const db = createAdminClient()
  const { data: refs } = await db.from('referrals').select('partner_id, status').eq('status', 'paid')
  const counts: Record<string, number> = {}
  for (const r of refs || []) counts[r.partner_id] = (counts[r.partner_id] || 0) + 1
  const ids = Object.keys(counts)
  const names: Record<string, string> = {}
  if (ids.length) {
    const { data: partners } = await db.from('partners').select('id, company_name, slug').in('id', ids)
    for (const p of partners || []) names[p.id] = p.company_name || p.slug
  }
  const rows = Object.entries(counts).map(([id, c]) => ({ id, name: names[id] || 'Partner', customers: c, isYou: id === ctx.partnerId }))
    .sort((a, b) => b.customers - a.customers).slice(0, 25).map((r, i) => ({ ...r, rank: i + 1 }))

  const medal = (rank: number) => rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`

  return (
    <div>
      <PageHeader title="Leaderboard" subtitle="Top partners by paying customers." />
      <Panel>
        {rows.length === 0 ? <EmptyRow>No paying customers on the board yet — be the first! 🏆</EmptyRow> : (
          <div className="divide-y divide-hairline">
            {rows.map((r) => (
              <div key={r.id} className={`flex items-center gap-3 py-3 ${r.isYou ? 'rounded-lg bg-accent/5 px-2' : ''}`}>
                <div className="w-10 text-center text-lg font-semibold text-subtle">{medal(r.rank)}</div>
                <div className="flex-1 font-medium text-ink">{r.name}{r.isYou && <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent-strong">You</span>}</div>
                <div className="flex items-center gap-1.5 text-sm text-subtle"><Trophy className="h-4 w-4 text-amber-500" /> {r.customers}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

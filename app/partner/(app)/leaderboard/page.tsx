import { getPartnerContext } from '@/lib/partner/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { PageHeader, Panel, EmptyRow } from '@/components/partner/ui'
import { Trophy, Crown, Medal } from 'lucide-react'

export const dynamic = 'force-dynamic'

// Scales to 100k+ partners: reads the cached partner_stats leaderboard (indexed order + limit),
// not a global referrals scan. "Your rank" is an indexed COUNT.
export default async function LeaderboardPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const db = createAdminClient()

  const { data: top } = await db.from('partner_stats')
    .select('partner_id, active_customers, xp, partners(company_name, slug)')
    .order('active_customers', { ascending: false }).order('xp', { ascending: false }).limit(25)

  const mine = (top || []).find((r) => r.partner_id === ctx.partnerId)
  const { data: self } = mine ? { data: null } : await db.from('partner_stats').select('active_customers').eq('partner_id', ctx.partnerId).maybeSingle()
  const myCustomers = mine?.active_customers ?? self?.active_customers ?? 0
  const { count: higher } = await db.from('partner_stats').select('partner_id', { count: 'exact', head: true }).gt('active_customers', myCustomers)
  const myRank = (higher || 0) + 1

  const rows = (top || []).map((r, i) => ({
    id: r.partner_id, rank: i + 1,
    name: (r.partners as unknown as { company_name?: string; slug?: string } | null)?.company_name || 'Partner',
    customers: r.active_customers || 0, isYou: r.partner_id === ctx.partnerId,
  }))

  return (
    <div>
      <PageHeader title="Leaderboard" subtitle="Top partners by paying customers." />

      {!rows.some((r) => r.isYou) && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-accent/25 bg-accent/5 p-3">
          <div className="w-10 text-center font-semibold text-accent-strong">#{myRank}</div>
          <div className="flex-1 font-medium text-ink">{ctx.companyName || 'You'} <span className="ml-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent-strong">You</span></div>
          <div className="inline-flex items-center gap-1.5 text-sm text-subtle"><Trophy className="h-4 w-4 text-amber-500" /> {myCustomers}</div>
        </div>
      )}

      <Panel>
        {rows.length === 0 ? <EmptyRow>No paying customers on the board yet — be the first!</EmptyRow> : (
          <div className="divide-y divide-hairline">
            {rows.map((r) => (
              <div key={r.id} className={`flex items-center gap-3 py-3 ${r.isYou ? 'rounded-lg bg-accent/5 px-2' : ''}`}>
                <div className="flex w-10 justify-center">
                  {r.rank === 1 ? <Crown className="h-5 w-5 text-amber-500" /> : r.rank <= 3 ? <Medal className="h-5 w-5 text-subtle" /> : <span className="text-sm font-semibold text-muted">#{r.rank}</span>}
                </div>
                <div className="flex-1 font-medium text-ink">{r.name}{r.isYou && <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent-strong">You</span>}</div>
                <div className="inline-flex items-center gap-1.5 text-sm text-subtle"><Trophy className="h-4 w-4 text-amber-500" /> {r.customers}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

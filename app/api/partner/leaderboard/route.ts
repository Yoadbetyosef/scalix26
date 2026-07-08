import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'

// Scales to 100k+ partners: cached partner_stats (indexed order+limit) + indexed rank COUNT.
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()

  const { data: top } = await db.from('partner_stats')
    .select('partner_id, active_customers, partners(company_name)')
    .order('active_customers', { ascending: false }).limit(25)

  const { data: self } = await db.from('partner_stats').select('active_customers').eq('partner_id', ctx.partnerId).maybeSingle()
  const myCustomers = self?.active_customers ?? 0
  const { count: higher } = await db.from('partner_stats').select('partner_id', { count: 'exact', head: true }).gt('active_customers', myCustomers)

  const leaderboard = (top || []).map((r, i) => ({
    rank: i + 1, name: (r.partners as unknown as { company_name?: string } | null)?.company_name || 'Partner',
    customers: r.active_customers || 0, isYou: r.partner_id === ctx.partnerId,
  }))
  return NextResponse.json({ leaderboard, you: { rank: (higher || 0) + 1, customers: myCustomers } })
}

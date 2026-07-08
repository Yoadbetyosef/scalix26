import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'

// Top partners by paid customers (all-time). Company names only — no financials leaked.
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  const rows = Object.entries(counts)
    .map(([id, customers]) => ({ partnerId: id, name: names[id] || 'Partner', customers, isYou: id === ctx.partnerId }))
    .sort((a, b) => b.customers - a.customers)
    .slice(0, 25)
    .map((r, i) => ({ ...r, rank: i + 1 }))

  const you = rows.find((r) => r.isYou) || { rank: null, customers: counts[ctx.partnerId] || 0, isYou: true, name: ctx.companyName || 'You' }
  return NextResponse.json({ leaderboard: rows, you })
}

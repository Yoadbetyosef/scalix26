import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'

// Aggregated analytics for the authed partner: funnel, monthly commission, and top links.
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()

  const [{ data: refs }, { data: entries }, { data: links }] = await Promise.all([
    db.from('referrals').select('status, created_at, last_touch_link_id').eq('partner_id', ctx.partnerId).neq('status', 'rejected'),
    db.from('commission_entries').select('amount_cents, status, created_at').eq('partner_id', ctx.partnerId),
    db.from('referral_links').select('id, label, code, click_count').eq('partner_id', ctx.partnerId),
  ])

  // Funnel counts.
  const all = refs || []
  const funnel = {
    clicks: (links || []).reduce((s, l) => s + (l.click_count || 0), 0),
    signups: all.length,
    trials: all.filter((r) => r.status === 'trial' || r.status === 'paid' || r.status === 'churned').length,
    paid: all.filter((r) => r.status === 'paid').length,
  }

  // Monthly commission (paid) — last 12 months.
  const byMonth: Record<string, number> = {}
  for (const e of entries || []) {
    if (e.status !== 'paid') continue
    const m = e.created_at.slice(0, 7)
    byMonth[m] = (byMonth[m] || 0) + e.amount_cents
  }
  const months: { month: string; cents: number }[] = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    months.push({ month: key, cents: byMonth[key] || 0 })
  }

  // Top links by paid conversions.
  const paidByLink: Record<string, number> = {}
  const signupByLink: Record<string, number> = {}
  for (const r of all) {
    const k = r.last_touch_link_id as string | null
    if (!k) continue
    signupByLink[k] = (signupByLink[k] || 0) + 1
    if (r.status === 'paid') paidByLink[k] = (paidByLink[k] || 0) + 1
  }
  const topLinks = (links || []).map((l) => ({
    label: l.label || l.code, clicks: l.click_count || 0,
    signups: signupByLink[l.id] || 0, paid: paidByLink[l.id] || 0,
  })).sort((a, b) => b.paid - a.paid || b.signups - a.signups).slice(0, 10)

  return NextResponse.json({ funnel, months, topLinks })
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { computePartnerStats } from '@/lib/partner/stats'

// Read-only commission ledger for the authed partner. Partners can never mutate their ledger.
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()

  const { data: entries } = await db.from('commission_entries')
    .select('id, entry_type, amount_cents, currency, status, source_event, period_start, period_end, created_at, tenant_id')
    .eq('partner_id', ctx.partnerId).order('created_at', { ascending: false }).limit(500)

  const sum = (pred: (e: { status: string; amount_cents: number }) => boolean) =>
    (entries || []).filter(pred).reduce((s, e) => s + e.amount_cents, 0)

  const paidEntries = (entries || []).filter((e) => e.status === 'paid' && e.amount_cents > 0)
  const stats = await computePartnerStats(ctx.partnerId)
  const summary = {
    pending_cents: sum((e) => e.status === 'pending'),
    approved_cents: sum((e) => e.status === 'approved'),
    paid_cents: sum((e) => e.status === 'paid'),
    lifetime_cents: sum((e) => e.status === 'paid'),
    // Economics dashboard
    estimated_next_payout_cents: sum((e) => e.status === 'pending' || e.status === 'approved'),
    monthly_recurring_income_cents: stats.monthly_commission_cents,
    projected_monthly_cents: stats.monthly_commission_cents,
    projected_annual_cents: stats.projected_annual_cents,
    portfolio_value_cents: stats.portfolio_value_cents,
    expansion_cents: stats.expansion_cents,
    churn_cents: stats.churn_cents,
    active_customers: stats.active_customers,
    average_commission_cents: paidEntries.length ? Math.round(paidEntries.reduce((s, e) => s + e.amount_cents, 0) / paidEntries.length) : 0,
    mrr_created_cents: stats.mrr_generated_cents,
  }

  const { data: payouts } = await db.from('payouts')
    .select('id, amount_cents, currency, status, period_start, period_end, statement_url, paid_at, created_at')
    .eq('partner_id', ctx.partnerId).order('created_at', { ascending: false }).limit(50)

  return NextResponse.json({ summary, entries: entries || [], payouts: payouts || [] })
}

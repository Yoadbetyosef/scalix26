import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { computePartnerStats } from '@/lib/partner/stats'
import { resolvePartnerEconomics, tierInfo, REFERENCE_PLAN_CENTS } from '@/lib/partner/economics-resolve'

// Read-only commission ledger for the authed partner. Partners can never mutate their ledger.
// Economics resolve via lib/partner/economics-resolve (the single source shared with the dashboard).

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()

  const { data: rawEntries } = await db.from('commission_entries')
    .select('id, entry_type, amount_cents, currency, status, source_event, source_ref, plan_id, tenant_id, period_start, period_end, created_at, paid_at')
    .eq('partner_id', ctx.partnerId).order('created_at', { ascending: false }).limit(500)
  const entries = rawEntries || []

  // Enrich with customer (tenant) name + commission plan name (bulk lookups, no N+1).
  const tenantIds = [...new Set(entries.map((e) => e.tenant_id).filter(Boolean))]
  const planIds = [...new Set(entries.map((e) => e.plan_id).filter(Boolean))]
  const [{ data: tenants }, { data: plans }] = await Promise.all([
    tenantIds.length ? db.from('tenants').select('id, business_name').in('id', tenantIds) : Promise.resolve({ data: [] }),
    planIds.length ? db.from('commission_plans').select('id, name').in('id', planIds) : Promise.resolve({ data: [] }),
  ])
  const tName = new Map((tenants || []).map((t: { id: string; business_name: string | null }) => [t.id, t.business_name]))
  const pName = new Map((plans || []).map((p: { id: string; name: string | null }) => [p.id, p.name]))
  const enriched = entries.map((e) => ({
    id: e.id, entry_type: e.entry_type, amount_cents: e.amount_cents, currency: e.currency, status: e.status,
    source: e.source_event ? 'stripe' : 'referral',
    customer_name: e.tenant_id ? tName.get(e.tenant_id) || 'Customer' : null,
    plan_name: e.plan_id ? pName.get(e.plan_id) || null : null,
    period_start: e.period_start, period_end: e.period_end, created_at: e.created_at, payout_date: e.paid_at,
  }))

  const sum = (pred: (e: { status: string; amount_cents: number }) => boolean) =>
    entries.filter(pred).reduce((s, e) => s + e.amount_cents, 0)
  const paidEntries = entries.filter((e) => e.status === 'paid' && e.amount_cents > 0)
  const stats = await computePartnerStats(ctx.partnerId)

  const summary = {
    pending_cents: sum((e) => e.status === 'pending'),
    approved_cents: sum((e) => e.status === 'approved'),
    paid_cents: sum((e) => e.status === 'paid'),
    lifetime_cents: sum((e) => e.status === 'paid'),
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

  // ── Resolve the deal once via the shared engine (same source the dashboard uses). ──
  const econ = await resolvePartnerEconomics(ctx.partnerId)
  const active = stats.active_customers
  const { tier, nextTier } = tierInfo(econ.plan, econ.ratePct, active)
  const currentRatePct = econ.ratePct

  const avgPerCustomer = active > 0 ? stats.monthly_commission_cents / active : null
  const needed = (targetCents: number) => avgPerCustomer && avgPerCustomer > 0 ? Math.max(0, Math.ceil(targetCents / avgPerCustomer) - active) : null
  const forecast = {
    monthly_recurring_cents: stats.monthly_commission_cents,
    projected_annual_cents: stats.projected_annual_cents,
    active_customers: active,
    avg_per_customer_cents: avgPerCustomer != null ? Math.round(avgPerCustomer) : null,
    customers_to_1000: needed(100000),
    customers_to_5000: needed(500000),
    current_rate_pct: currentRatePct,
    next_tier: nextTier ? { at_customers: nextTier.at_customers, pct: nextTier.pct } : null,
  }

  // "My Partner Deal" — resolved economics, no hardcoded values.
  const deal = {
    partner_type: econ.partnerType,
    billing_mode: econ.billingMode,
    plan_name: econ.plan?.name ?? null,
    model: econ.model,
    is_recurring: econ.isRecurring,
    duration_months: econ.durationMonths,                    // null = lifetime (if recurring)
    current_rate_pct: currentRatePct,
    base_rate_pct: econ.plan?.recurring_pct ?? null,
    tier,
    next_tier: nextTier,
    active_customers: active,
    approval_days: Number(process.env.PARTNER_COMMISSION_HOLD_DAYS) || 30,
    clawback_window_days: econ.clawbackWindowDays,
    payout_schedule: econ.payoutSchedule,
    deal_source: econ.source,
    currency: econ.currency,
    // Wholesale relationship fields (white_label / reseller) — drive the mode-aware view.
    wholesale_discount_pct: econ.wholesaleDiscountPct,
    platform_fee_cents: econ.platformFeeCents,
    setup_fee_cents: econ.setupFeeCents,
    reference_retail_cents: REFERENCE_PLAN_CENTS,
  }

  const { data: payouts } = await db.from('payouts')
    .select('id, amount_cents, currency, status, period_start, period_end, statement_url, paid_at, created_at')
    .eq('partner_id', ctx.partnerId).order('created_at', { ascending: false }).limit(50)

  return NextResponse.json({ summary, forecast, deal, entries: enriched, payouts: payouts || [] })
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { computePartnerStats } from '@/lib/partner/stats'
import { resolvePct } from '@/lib/partner/commission'

// Read-only commission ledger for the authed partner. Partners can never mutate their ledger.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any
type DealSource = 'custom_deal' | 'partner_default' | 'global_default'
interface PlanRow {
  name: string | null; recurring_pct: number | null; model: string; duration_months: number | null
  tiers: { min_customers: number | null; min_volume_cents: number | null; pct: number }[] | null
  clawback_window_days: number | null; payout_schedule: string | null; currency: string | null
}
const PLAN_COLS = 'name, model, recurring_pct, duration_months, tiers, clawback_window_days, payout_schedule, currency'

// Resolve the partner's effective commission plan (Sprint 2 order: partner_deal → partner default →
// global default) and report which source won — no new logic, mirrors getEffectivePlan.
async function resolveEffectivePlan(db: Db, partnerId: string): Promise<{ plan: PlanRow | null; source: DealSource }> {
  const now = new Date().toISOString()
  const { data: deal } = await db.from('partner_deals').select('commission_plan_id')
    .eq('partner_id', partnerId).eq('active', true).not('commission_plan_id', 'is', null)
    .or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (deal?.commission_plan_id) {
    const { data } = await db.from('commission_plans').select(PLAN_COLS).eq('id', deal.commission_plan_id).maybeSingle()
    if (data) return { plan: data as PlanRow, source: 'custom_deal' }
  }
  const { data: partner } = await db.from('partners').select('default_commission_plan_id').eq('id', partnerId).maybeSingle()
  if (partner?.default_commission_plan_id) {
    const { data } = await db.from('commission_plans').select(PLAN_COLS).eq('id', partner.default_commission_plan_id).maybeSingle()
    if (data) return { plan: data as PlanRow, source: 'partner_default' }
  }
  const { data } = await db.from('commission_plans').select(PLAN_COLS).is('partner_id', null).eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return { plan: (data as PlanRow) || null, source: 'global_default' }
}

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

  // ── Resolve the deal once (Sprint 2 Economics Engine) and derive rate/tier for both the deal
  //    card and the forecast. Real data only — no hardcoded rates. ──
  const { plan, source: dealSource } = await resolveEffectivePlan(db, ctx.partnerId)
  const { data: partnerRow } = await db.from('partners').select('partner_type, billing_mode').eq('id', ctx.partnerId).maybeSingle()
  const active = stats.active_customers

  let currentRatePct: number | null = null
  let nextTier: { at_customers: number; pct: number } | null = null
  let tier: { index: number; total: number; pct: number | null } | null = null
  if (plan) {
    currentRatePct = plan.model === 'tiered' && plan.tiers?.length
      ? await resolvePct(db as Parameters<typeof resolvePct>[0], plan as unknown as Parameters<typeof resolvePct>[1], ctx.partnerId)
      : (plan.recurring_pct ?? null)
    if (plan.tiers?.length) {
      const sorted = [...plan.tiers].sort((a, b) => (a.min_customers ?? 0) - (b.min_customers ?? 0))
      const metCount = sorted.filter((t) => t.min_customers == null || t.min_customers <= active).length
      tier = { index: Math.max(1, metCount), total: sorted.length, pct: currentRatePct }
      const upcoming = sorted.filter((t) => t.min_customers != null && t.min_customers > active && t.pct > (currentRatePct ?? 0))[0]
      if (upcoming) nextTier = { at_customers: upcoming.min_customers!, pct: upcoming.pct }
    }
  }

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
    next_tier: nextTier,
  }

  // "My Partner Deal" — resolved economics, no hardcoded values.
  const deal = {
    partner_type: partnerRow?.partner_type ?? null,
    billing_mode: partnerRow?.billing_mode ?? null,
    plan_name: plan?.name ?? null,
    model: plan?.model ?? null,
    is_recurring: plan ? ['recurring_pct', 'tiered', 'hybrid'].includes(plan.model) : false,
    duration_months: plan?.duration_months ?? null,          // null = lifetime (if recurring)
    current_rate_pct: currentRatePct,
    base_rate_pct: plan?.recurring_pct ?? null,
    tier,
    next_tier: nextTier ? { ...nextTier, customers_remaining: Math.max(0, nextTier.at_customers - active) } : null,
    active_customers: active,
    approval_days: Number(process.env.PARTNER_COMMISSION_HOLD_DAYS) || 30,
    clawback_window_days: plan?.clawback_window_days ?? null,
    payout_schedule: plan?.payout_schedule ?? null,
    deal_source: dealSource,
    currency: plan?.currency ?? 'usd',
  }

  const { data: payouts } = await db.from('payouts')
    .select('id, amount_cents, currency, status, period_start, period_end, statement_url, paid_at, created_at')
    .eq('partner_id', ctx.partnerId).order('created_at', { ascending: false }).limit(50)

  return NextResponse.json({ summary, forecast, deal, entries: enriched, payouts: payouts || [] })
}

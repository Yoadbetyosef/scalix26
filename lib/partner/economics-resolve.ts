import { createAdminClient } from '@/lib/supabase/server'
import { resolvePct } from '@/lib/partner/commission'
import type { PriceBook, PriceBookItem, PartnerClient } from '@/lib/partner/wholesale'
export type { PriceBook, PriceBookItem, PartnerClient, WholesaleSummary } from '@/lib/partner/wholesale'
export { effectiveItemPricing, computeWholesaleSummary } from '@/lib/partner/wholesale'

// THE single source of truth for a partner's resolved economics. Resolution order mirrors the
// Sprint 2 Economics Engine (getEffectivePlan): active partner_deal → partner default plan →
// global default. Rate uses resolvePct (tiers). Consumed by /partner/commissions AND the partner
// dashboard so every money number agrees. No duplicate commission math, no hardcoded percentages.

export type BillingMode = 'revenue_share' | 'reseller' | 'white_label'
export type DealSource = 'custom_deal' | 'partner_default' | 'global_default'
export interface EffectivePlan {
  name: string | null; model: string; recurring_pct: number | null; duration_months: number | null
  tiers: { min_customers: number | null; min_volume_cents: number | null; pct: number }[] | null
  clawback_window_days: number | null; payout_schedule: string | null; currency: string | null
  wholesale_discount_pct: number | null; platform_fee_cents: number | null; setup_fee_cents: number | null
}
export interface PartnerEconomics {
  partnerType: string | null; billingMode: BillingMode
  plan: EffectivePlan | null; source: DealSource
  ratePct: number | null; model: string | null; isRecurring: boolean
  durationMonths: number | null; clawbackWindowDays: number | null; payoutSchedule: string | null; currency: string
  wholesaleDiscountPct: number | null; platformFeeCents: number | null; setupFeeCents: number | null
  // White label / reseller pricing (database-driven — no hardcoded values).
  priceBook: PriceBook | null; customWholesaleDiscountPct: number | null; retailMarkupPct: number | null
}

const PB_ITEM_COLS = 'id, plan_name, plan_code, wholesale_price_cents, suggested_retail_price_cents, setup_fee_cents, included_ai_employees, included_phone_numbers, notes, sort_order'

const PLAN_COLS = 'name, model, recurring_pct, duration_months, tiers, clawback_window_days, payout_schedule, currency, wholesale_discount_pct, platform_fee_cents, setup_fee_cents'
// Reference plan price used ONLY to project unrealized income before a partner has real paid
// customers. The RATE always comes from the resolved plan — this is just the assumed sale price.
export const REFERENCE_PLAN_CENTS = 29700

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

async function resolveEffectivePlan(db: Db, partnerId: string): Promise<{ plan: EffectivePlan | null; source: DealSource }> {
  const now = new Date().toISOString()
  const { data: deal } = await db.from('partner_deals').select('commission_plan_id')
    .eq('partner_id', partnerId).eq('active', true).not('commission_plan_id', 'is', null)
    .or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (deal?.commission_plan_id) {
    const { data } = await db.from('commission_plans').select(PLAN_COLS).eq('id', deal.commission_plan_id).maybeSingle()
    if (data) return { plan: data as EffectivePlan, source: 'custom_deal' }
  }
  const { data: partner } = await db.from('partners').select('default_commission_plan_id').eq('id', partnerId).maybeSingle()
  if (partner?.default_commission_plan_id) {
    const { data } = await db.from('commission_plans').select(PLAN_COLS).eq('id', partner.default_commission_plan_id).maybeSingle()
    if (data) return { plan: data as EffectivePlan, source: 'partner_default' }
  }
  const { data } = await db.from('commission_plans').select(PLAN_COLS).is('partner_id', null).eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return { plan: (data as EffectivePlan) || null, source: 'global_default' }
}

export async function resolvePartnerEconomics(partnerId: string): Promise<PartnerEconomics> {
  const db = createAdminClient()
  const [{ plan, source }, { data: p }] = await Promise.all([
    resolveEffectivePlan(db, partnerId),
    db.from('partners').select('partner_type, billing_mode, price_book_id, custom_wholesale_discount_pct, retail_markup_pct').eq('id', partnerId).maybeSingle(),
  ])
  let ratePct: number | null = null
  if (plan) {
    ratePct = plan.model === 'tiered' && plan.tiers?.length
      ? await resolvePct(db as Parameters<typeof resolvePct>[0], plan as unknown as Parameters<typeof resolvePct>[1], partnerId)
      : (plan.recurring_pct ?? null)
  }
  const billingMode = ((p?.billing_mode as BillingMode) || 'revenue_share')

  // Load the assigned price book + active items (white_label / reseller only).
  let priceBook: PriceBook | null = null
  if (p?.price_book_id) {
    const [{ data: book }, { data: items }] = await Promise.all([
      db.from('partner_price_books').select('id, name, billing_mode, description').eq('id', p.price_book_id).maybeSingle(),
      db.from('partner_price_book_items').select(PB_ITEM_COLS).eq('price_book_id', p.price_book_id).eq('is_active', true).order('sort_order'),
    ])
    if (book) priceBook = { id: book.id, name: book.name, billing_mode: book.billing_mode as 'white_label' | 'reseller', description: book.description, items: (items || []) as PriceBookItem[] }
  }

  return {
    partnerType: p?.partner_type ?? null, billingMode,
    plan, source, ratePct, model: plan?.model ?? null,
    isRecurring: plan ? ['recurring_pct', 'tiered', 'hybrid'].includes(plan.model) : false,
    durationMonths: plan?.duration_months ?? null, clawbackWindowDays: plan?.clawback_window_days ?? null,
    payoutSchedule: plan?.payout_schedule ?? null, currency: plan?.currency ?? 'usd',
    wholesaleDiscountPct: plan?.wholesale_discount_pct ?? null, platformFeeCents: plan?.platform_fee_cents ?? null, setupFeeCents: plan?.setup_fee_cents ?? null,
    priceBook, customWholesaleDiscountPct: p?.custom_wholesale_discount_pct ?? null, retailMarkupPct: p?.retail_markup_pct ?? null,
  }
}

// ── Client accounts (white_label / reseller) ──
export async function getPartnerClients(partnerId: string): Promise<PartnerClient[]> {
  const db = createAdminClient()
  const { data } = await db.from('partner_clients')
    .select('id, business_name, tenant_id, plan_code, retail_price_cents, wholesale_price_cents, status, created_at, tenants(business_name)')
    .eq('partner_id', partnerId).order('created_at', { ascending: false })
  return (data || []).map((c) => ({
    id: c.id, tenant_id: c.tenant_id, plan_code: c.plan_code, retail_price_cents: c.retail_price_cents,
    wholesale_price_cents: c.wholesale_price_cents, status: c.status, created_at: c.created_at,
    business_name: c.business_name || (c.tenants as unknown as { business_name?: string } | null)?.business_name || 'Client',
  }))
}

// Estimated monthly commission per customer BEFORE real paid customers exist. The rate is resolved;
// only the reference sale price is assumed. (Once real customers exist, callers use actuals.)
export function estPerCustomerMonthlyCents(ratePct: number | null): number {
  return Math.round(((ratePct ?? 30) / 100) * REFERENCE_PLAN_CENTS)
}

export interface TierInfo {
  tier: { index: number; total: number; pct: number | null } | null
  nextTier: { at_customers: number; pct: number; customers_remaining: number } | null
}
export function tierInfo(plan: EffectivePlan | null, ratePct: number | null, activeCustomers: number): TierInfo {
  if (!plan?.tiers?.length) return { tier: null, nextTier: null }
  const sorted = [...plan.tiers].sort((a, b) => (a.min_customers ?? 0) - (b.min_customers ?? 0))
  const metCount = sorted.filter((t) => t.min_customers == null || t.min_customers <= activeCustomers).length
  const tier = { index: Math.max(1, metCount), total: sorted.length, pct: ratePct }
  const upcoming = sorted.filter((t) => t.min_customers != null && t.min_customers > activeCustomers && t.pct > (ratePct ?? 0))[0]
  const nextTier = upcoming ? { at_customers: upcoming.min_customers!, pct: upcoming.pct, customers_remaining: Math.max(0, upcoming.min_customers! - activeCustomers) } : null
  return { tier, nextTier }
}

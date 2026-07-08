import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/server'

// Commission ledger PRIMITIVES + plan/deal/promotion resolution. The append-only, idempotent
// ledger is the single source of financial truth; economics.ts (the event processor) is the only
// caller that turns billing_events into entries. Service-role only.

export type Db = ReturnType<typeof createAdminClient>

export interface PlanRow {
  id: string
  model: 'recurring_pct' | 'one_time' | 'tiered' | 'hybrid' | 'wholesale' | 'white_label' | 'custom'
  recurring_pct: number | null
  one_time_cents: number | null
  duration_months: number | null
  tiers: { min_customers?: number; min_volume_cents?: number; pct: number }[] | null
  clawback_window_days: number
  wholesale_discount_pct: number | null
  platform_fee_cents: number | null
  setup_fee_cents: number | null
  currency: string
}

export interface ReferralRow {
  id: string
  partner_id: string
  tenant_id: string
  status: string
  commission_plan_id: string | null
  converted_at: string | null
  demo_id: string | null
}

/** Idempotent ledger insert. Returns true if a NEW entry was written. Every entry carries the
 *  billing event that produced it (source_event_id) for full traceability. */
export async function insertEntry(db: Db, e: {
  partner_id: string; referral_id?: string | null; tenant_id?: string | null; plan_id?: string | null
  campaign_id?: string | null; entry_type: string; amount_cents: number; currency: string
  status?: string; source_event?: string; source_ref?: string; source_event_id?: string | null
  period_start?: string | null; period_end?: string | null; idempotency_key: string; note?: string
}): Promise<boolean> {
  const { data } = await db.from('commission_entries')
    .upsert({ status: 'pending', ...e }, { onConflict: 'idempotency_key', ignoreDuplicates: true })
    .select('id')
  const inserted = !!(data && data.length)
  if (inserted && e.amount_cents !== 0) {
    await db.from('partner_notifications').insert({
      partner_id: e.partner_id, kind: 'commission_earned',
      title: e.amount_cents > 0 ? 'Commission earned' : 'Commission adjusted',
      body: `${e.entry_type} · ${(e.amount_cents / 100).toLocaleString('en-US', { style: 'currency', currency: e.currency.toUpperCase() })}`,
      link: '/partner/commissions',
    })
  }
  return inserted
}

/**
 * Auto-approve pending commission entries older than the hold window (default 30 days). Partners
 * see money move pending → approved automatically. Clawbacks create offsetting entries independently.
 */
export async function autoApproveCommissions(holdDays = Number(process.env.PARTNER_COMMISSION_HOLD_DAYS) || 30): Promise<number> {
  const db = createAdminClient()
  const cutoff = new Date(Date.now() - holdDays * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await db.from('commission_entries')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('status', 'pending').lt('created_at', cutoff).select('id')
  return data?.length || 0
}

export async function getReferralForTenant(db: Db, tenantId: string): Promise<ReferralRow | null> {
  const { data } = await db.from('referrals')
    .select('id, partner_id, tenant_id, status, commission_plan_id, converted_at, demo_id')
    .eq('tenant_id', tenantId).maybeSingle()
  if (!data || data.status === 'rejected') return null // only attributed, non-rejected referrals earn
  return data as ReferralRow
}

/**
 * Resolve the effective commission plan. Order: active partner_deal → referral snapshot →
 * partner default → active global default. Nothing hardcoded — all editable from Admin.
 */
export async function getEffectivePlan(db: Db, ref: ReferralRow): Promise<PlanRow | null> {
  const now = new Date().toISOString()
  const { data: deal } = await db.from('partner_deals').select('commission_plan_id')
    .eq('partner_id', ref.partner_id).eq('active', true).not('commission_plan_id', 'is', null)
    .or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  const tryIds = [deal?.commission_plan_id, ref.commission_plan_id].filter(Boolean) as string[]
  for (const id of tryIds) {
    const { data } = await db.from('commission_plans').select('*').eq('id', id).maybeSingle()
    if (data) return data as PlanRow
  }
  const { data: partner } = await db.from('partners').select('default_commission_plan_id').eq('id', ref.partner_id).maybeSingle()
  if (partner?.default_commission_plan_id) {
    const { data } = await db.from('commission_plans').select('*').eq('id', partner.default_commission_plan_id).maybeSingle()
    if (data) return data as PlanRow
  }
  const { data } = await db.from('commission_plans').select('*').is('partner_id', null).eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (data as PlanRow) || null
}

/** Effective recurring %, applying tiers by paid-customer count / cumulative volume. Snapshotted per entry. */
export async function resolvePct(db: Db, plan: PlanRow, partnerId: string): Promise<number> {
  const base = plan.recurring_pct || 0
  if (plan.model !== 'tiered' || !plan.tiers?.length) return base
  const [{ count: paidCustomers }, { data: paidAgg }] = await Promise.all([
    db.from('referrals').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId).eq('status', 'paid'),
    db.from('commission_entries').select('amount_cents').eq('partner_id', partnerId).in('status', ['approved', 'paid']),
  ])
  const cumVolume = (paidAgg || []).reduce((s, r) => s + (r.amount_cents || 0), 0)
  let pct = base
  for (const tier of plan.tiers) {
    const meetsCount = tier.min_customers == null || (paidCustomers ?? 0) >= tier.min_customers
    const meetsVol = tier.min_volume_cents == null || cumVolume >= tier.min_volume_cents
    if (meetsCount && meetsVol) pct = Math.max(pct, tier.pct)
  }
  return pct
}

export function periodOf(invoice: Stripe.Invoice): { start: string | null; end: string | null } {
  const line = invoice.lines?.data?.[0]
  const p = line?.period
  return { start: p?.start ? new Date(p.start * 1000).toISOString().slice(0, 10) : null, end: p?.end ? new Date(p.end * 1000).toISOString().slice(0, 10) : null }
}

/**
 * Evaluate active promotions (generalized bonus_campaigns) for an event. Supports the legacy
 * amount_cents/partner_type columns AND the new conditions/reward/eligibility JSON — so contests,
 * seasonal, performance, and one-time bonuses plug in via config with no code change.
 */
export async function evaluatePromotions(db: Db, ref: ReferralRow, eventType: string, currency: string): Promise<void> {
  const now = new Date().toISOString()
  const { data: campaigns } = await db.from('bonus_campaigns').select('*')
    .eq('active', true)
    .or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`)
  if (!campaigns?.length) return

  const { data: partner } = await db.from('partners').select('partner_type').eq('id', ref.partner_id).maybeSingle()
  const KIND_EVENT: Record<string, string> = { signup_bounty: 'trial_started', conversion_bounty: 'converted_paid' }

  for (const c of campaigns) {
    const cond = (c.conditions || {}) as { event_type?: string }
    const targetEvent = cond.event_type || KIND_EVENT[c.kind]
    if (targetEvent && targetEvent !== eventType) continue
    if (!targetEvent) continue // volume/contest/performance are evaluated by the cron, not per-event

    const elig = (c.eligibility || {}) as { partner_types?: string[] }
    const typeGate = c.partner_type || (elig.partner_types?.length ? elig.partner_types : null)
    if (typeGate) {
      const allowed = Array.isArray(typeGate) ? typeGate : [typeGate]
      if (!allowed.includes(partner?.partner_type || '')) continue
    }

    const reward = (c.reward || {}) as { amount_cents?: number }
    const amount = reward.amount_cents ?? c.amount_cents
    if (amount) {
      await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: ref.tenant_id, campaign_id: c.id, entry_type: 'bonus', amount_cents: amount, currency, source_event: 'promotion', source_ref: c.id, idempotency_key: `bonus:${c.id}:${ref.id}` })
    }
  }
}

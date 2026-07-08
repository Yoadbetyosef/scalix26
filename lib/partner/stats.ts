import { createAdminClient } from '@/lib/supabase/server'
import { PLANS } from '@/lib/stripe/client'
import { awardXp, totalXp, computeStreak, levelForXp, ACHIEVEMENTS } from '@/lib/partner/xp'

// Computes a partner's dashboard KPIs from the referrals + commission ledger. Written to the
// partner_stats cache so the dashboard reads one row instead of live-aggregating. Compute-on-read
// keeps it fresh at current scale; a nightly cron can call recomputeAllPartnerStats() later.

export interface PartnerStats {
  mrr_generated_cents: number
  active_customers: number
  total_customers: number
  new_customers_30d: number
  trial_customers: number
  churned_customers: number
  conversion_rate: number
  pending_commission_cents: number
  paid_commission_cents: number
  lifetime_earnings_cents: number
  health_score: number
  // Economics (Sprint 2) — derived from the commission ledger / referrals.
  monthly_commission_cents: number   // recurring commission run-rate (last ~35d of recurring entries)
  expansion_cents: number            // lifetime expansion commission
  churn_cents: number                // MRR lost to churned customers
  portfolio_value_cents: number      // estimated recurring portfolio value (≈ 2× ARR)
  projected_annual_cents: number     // monthly_commission × 12
}

function planMrrCents(plan: string | null | undefined): number {
  if (!plan || plan === 'trial') return 0
  const p = PLANS[plan as keyof typeof PLANS]
  return p ? Math.round(p.price * 100) : 0
}

export async function computePartnerStats(partnerId: string): Promise<PartnerStats> {
  const db = createAdminClient()
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const since35 = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString()
  const [{ data: refs }, { data: entries }] = await Promise.all([
    db.from('referrals').select('status, created_at, tenant_id, tenants(plan)').eq('partner_id', partnerId).neq('status', 'rejected'),
    db.from('commission_entries').select('amount_cents, status, entry_type, created_at').eq('partner_id', partnerId),
  ])

  const all = refs || []
  const paid = all.filter((r) => r.status === 'paid')
  const churned = all.filter((r) => r.status === 'churned')
  const trials = all.filter((r) => r.status === 'signup' || r.status === 'trial')
  const new30 = all.filter((r) => r.created_at >= since30)

  const mrr = paid.reduce((s, r) => {
    const plan = (r.tenants as unknown as { plan?: string } | null)?.plan
    return s + planMrrCents(plan)
  }, 0)

  const total = all.length
  const conversion = total > 0 ? Math.round((paid.length / total) * 10000) / 100 : 0

  const ents = (entries || []) as { amount_cents: number; status: string; entry_type: string; created_at: string }[]
  const sum = (pred: (e: { status: string }) => boolean) => ents.filter(pred).reduce((s, e) => s + e.amount_cents, 0)
  const pending = sum((e) => e.status === 'pending')
  const paidComm = sum((e) => e.status === 'paid')

  // Economics: recurring run-rate (last 35d of recurring commission), lifetime expansion, churn MRR.
  const monthlyCommission = ents.filter((e) => e.entry_type === 'recurring' && e.created_at >= since35 && e.status !== 'void').reduce((s, e) => s + e.amount_cents, 0)
  const expansion = ents.filter((e) => e.entry_type === 'expansion' && e.status !== 'void').reduce((s, e) => s + e.amount_cents, 0)
  const churnMrr = churned.reduce((s, r) => s + planMrrCents((r.tenants as unknown as { plan?: string } | null)?.plan), 0)
  const projectedAnnual = monthlyCommission * 12
  const portfolioValue = projectedAnnual * 2   // rough estimate: ~2× ARR of recurring commission

  // Health score (0–100): conversion (40) + retention (30) + activity/recency (30).
  const retentionBase = paid.length + churned.length
  const retention = retentionBase > 0 ? paid.length / retentionBase : (paid.length > 0 ? 1 : 0)
  const activity = new30.length > 0 ? 1 : (paid.length > 0 ? 0.5 : 0)
  const health = Math.round(Math.min(conversion, 100) / 100 * 40 + retention * 30 + activity * 30)

  return {
    mrr_generated_cents: mrr,
    active_customers: paid.length,
    total_customers: total,
    new_customers_30d: new30.length,
    trial_customers: trials.length,
    churned_customers: churned.length,
    conversion_rate: conversion,
    pending_commission_cents: pending,
    paid_commission_cents: paidComm,
    lifetime_earnings_cents: paidComm,
    health_score: health,
    monthly_commission_cents: monthlyCommission,
    expansion_cents: expansion,
    churn_cents: churnMrr,
    portfolio_value_cents: portfolioValue,
    projected_annual_cents: projectedAnnual,
  }
}

export interface PartnerStatsFull extends PartnerStats {
  xp: number; level: string; global_rank: number | null; streak_days: number
}

/** Compute + persist to the partner_stats cache (incl. XP/level/rank/streak). Grants milestone
 * achievements idempotently. Returns the fresh stats. */
export async function refreshPartnerStats(partnerId: string): Promise<PartnerStatsFull> {
  const stats = await computePartnerStats(partnerId)
  const db = createAdminClient()

  // Grant milestone achievements (idempotent) from the aggregates.
  await grantMilestones(db, partnerId, stats)

  const xp = await totalXp(db, partnerId)
  const lvl = levelForXp(xp)
  const streak = await computeStreak(db, partnerId)

  // Global rank via an indexed COUNT (scales to 100k+ — no full-table scan).
  const { count: higher } = await db.from('partner_stats').select('partner_id', { count: 'exact', head: true }).gt('xp', xp)
  const globalRank = (higher || 0) + 1

  await db.from('partner_stats').upsert({
    partner_id: partnerId, ...stats, xp, level: lvl.level, global_rank: globalRank, streak_days: streak,
    computed_at: new Date().toISOString(),
  }, { onConflict: 'partner_id' })
  await db.from('partners').update({ health_score: stats.health_score }).eq('id', partnerId)
  return { ...stats, xp, level: lvl.level, global_rank: globalRank, streak_days: streak }
}

async function grantMilestones(db: ReturnType<typeof createAdminClient>, partnerId: string, s: PartnerStats): Promise<void> {
  const { count: demoCount } = await db.from('demos').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId)
  const { data: partner } = await db.from('partners').select('created_at').eq('id', partnerId).maybeSingle()
  const ageDays = partner?.created_at ? (Date.now() - new Date(partner.created_at).getTime()) / 86400000 : 0

  const checks: { cond: boolean; a: keyof typeof ACHIEVEMENTS }[] = [
    { cond: s.total_customers >= 1, a: 'first_referral' },
    { cond: (demoCount || 0) >= 1, a: 'first_demo' },
    { cond: s.active_customers >= 1, a: 'first_customer' },
    { cond: s.active_customers >= 10, a: 'ten_customers' },
    { cond: s.active_customers >= 100, a: 'hundred_customers' },
    { cond: s.lifetime_earnings_cents >= 100000, a: 'commission_1k' },
    { cond: s.lifetime_earnings_cents >= 1000000, a: 'commission_10k' },
    { cond: ageDays >= 365, a: 'one_year' },
  ]
  for (const { cond, a } of checks) {
    if (!cond) continue
    const ach = ACHIEVEMENTS[a]
    await awardXp(partnerId, `ach:${ach.key}`, ach.xp, { uniqueKey: `ach:${ach.key}:${partnerId}`, label: ach.label, meta: { icon: ach.icon } })
  }
}

/**
 * Read the cached stats row; refresh only if missing or stale. Keeps dashboard/coach loads O(1)
 * DB reads instead of a full recompute on every navigation (scales to 100k+ partners).
 */
export async function getPartnerStatsCached(partnerId: string, maxAgeMs = 5 * 60 * 1000): Promise<PartnerStatsFull> {
  const db = createAdminClient()
  const { data } = await db.from('partner_stats').select('*').eq('partner_id', partnerId).maybeSingle()
  if (!data || (data.computed_at && Date.now() - new Date(data.computed_at).getTime() > maxAgeMs)) {
    return refreshPartnerStats(partnerId)
  }
  return {
    mrr_generated_cents: data.mrr_generated_cents, active_customers: data.active_customers, total_customers: data.total_customers,
    new_customers_30d: data.new_customers_30d, trial_customers: data.trial_customers, churned_customers: data.churned_customers,
    conversion_rate: data.conversion_rate, pending_commission_cents: data.pending_commission_cents, paid_commission_cents: data.paid_commission_cents,
    lifetime_earnings_cents: data.lifetime_earnings_cents, health_score: data.health_score,
    monthly_commission_cents: data.monthly_commission_cents ?? 0, expansion_cents: data.expansion_cents ?? 0,
    churn_cents: data.churn_cents ?? 0, portfolio_value_cents: data.portfolio_value_cents ?? 0,
    projected_annual_cents: data.projected_annual_cents ?? 0,
    xp: data.xp, level: data.level, global_rank: data.global_rank, streak_days: data.streak_days,
  }
}

/**
 * Recompute stats for partners with RECENT activity only (bounded work — scales to 100k+ partners
 * where recomputing everyone nightly is infeasible). Activity = an XP event or referral in the
 * window. A slow full sweep can still be triggered explicitly if ever needed.
 */
export async function recomputeAllPartnerStats(windowHours = 25): Promise<number> {
  const db = createAdminClient()
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()
  const [{ data: xpRows }, { data: refRows }] = await Promise.all([
    db.from('partner_xp_events').select('partner_id').gte('created_at', cutoff),
    db.from('referrals').select('partner_id').gte('created_at', cutoff),
  ])
  const ids = new Set<string>([...(xpRows || []).map((r) => r.partner_id), ...(refRows || []).map((r) => r.partner_id)])
  let n = 0
  for (const id of ids) { await refreshPartnerStats(id); n++ }
  return n
}

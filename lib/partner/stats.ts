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
}

function planMrrCents(plan: string | null | undefined): number {
  if (!plan || plan === 'trial') return 0
  const p = PLANS[plan as keyof typeof PLANS]
  return p ? Math.round(p.price * 100) : 0
}

export async function computePartnerStats(partnerId: string): Promise<PartnerStats> {
  const db = createAdminClient()
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: refs }, { data: entries }] = await Promise.all([
    db.from('referrals').select('status, created_at, tenant_id, tenants(plan)').eq('partner_id', partnerId).neq('status', 'rejected'),
    db.from('commission_entries').select('amount_cents, status').eq('partner_id', partnerId),
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

  const sum = (pred: (e: { status: string }) => boolean) => (entries || []).filter(pred).reduce((s, e) => s + e.amount_cents, 0)
  const pending = sum((e) => e.status === 'pending')
  const paidComm = sum((e) => e.status === 'paid')

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

  // Global rank by cached XP (approximate at scale, exact enough here).
  const { data: others } = await db.from('partner_stats').select('partner_id, xp')
  const higher = (others || []).filter((o) => o.partner_id !== partnerId && (o.xp || 0) > xp).length
  const globalRank = higher + 1

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

/** Recompute every partner (nightly cron / admin trigger). */
export async function recomputeAllPartnerStats(): Promise<number> {
  const db = createAdminClient()
  const { data: partners } = await db.from('partners').select('id').eq('status', 'active')
  let n = 0
  for (const p of partners || []) { await refreshPartnerStats(p.id); n++ }
  return n
}

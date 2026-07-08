import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/server'
import { logPartnerAction } from '@/lib/partner/audit'
import { awardXp, XP } from '@/lib/partner/xp'
import { sendEmail, emailTemplates } from '@/lib/email/send'

const PARTNER_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.scalix26.com'

// The commission engine. Every ledger write goes through insertEntry(), which upserts on the
// unique idempotency_key so Stripe's at-least-once webhook delivery can never double-pay. Paid
// entries are never mutated — corrections are new offsetting entries. Service-role only.

type Db = ReturnType<typeof createAdminClient>

interface PlanRow {
  id: string
  model: 'recurring_pct' | 'one_time' | 'tiered' | 'hybrid'
  recurring_pct: number | null
  one_time_cents: number | null
  duration_months: number | null
  tiers: { min_customers?: number; min_volume_cents?: number; pct: number }[] | null
  clawback_window_days: number
  currency: string
}

interface ReferralRow {
  id: string
  partner_id: string
  tenant_id: string
  status: string
  commission_plan_id: string | null
  converted_at: string | null
  demo_id: string | null
}

/** Idempotent ledger insert. Returns true if a NEW entry was written. */
async function insertEntry(db: Db, e: {
  partner_id: string; referral_id?: string | null; tenant_id?: string | null; plan_id?: string | null
  campaign_id?: string | null; entry_type: string; amount_cents: number; currency: string
  status?: string; source_event?: string; source_ref?: string; period_start?: string | null
  period_end?: string | null; idempotency_key: string; note?: string
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
 * Auto-approve pending commission entries older than the hold window (default 30 days). This is
 * the trust mechanism: partners see money move from 'pending' → 'approved' automatically instead
 * of waiting on a human. Clawbacks (churn) still create offsetting entries independently.
 */
export async function autoApproveCommissions(holdDays = Number(process.env.PARTNER_COMMISSION_HOLD_DAYS) || 30): Promise<number> {
  const db = createAdminClient()
  const cutoff = new Date(Date.now() - holdDays * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await db.from('commission_entries')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('status', 'pending').lt('created_at', cutoff).select('id')
  return data?.length || 0
}

async function getReferralForTenant(db: Db, tenantId: string): Promise<ReferralRow | null> {
  const { data } = await db.from('referrals')
    .select('id, partner_id, tenant_id, status, commission_plan_id, converted_at, demo_id')
    .eq('tenant_id', tenantId).maybeSingle()
  // Only attributed, non-rejected referrals earn.
  if (!data || data.status === 'rejected') return null
  return data as ReferralRow
}

async function getPlan(db: Db, ref: ReferralRow): Promise<PlanRow | null> {
  // Prefer the plan snapshotted at attribution; else the partner default; else the global default.
  const tryIds = [ref.commission_plan_id].filter(Boolean) as string[]
  if (tryIds.length) {
    const { data } = await db.from('commission_plans').select('*').eq('id', tryIds[0]).maybeSingle()
    if (data) return data as PlanRow
  }
  const { data: partner } = await db.from('partners').select('default_commission_plan_id').eq('id', ref.partner_id).maybeSingle()
  if (partner?.default_commission_plan_id) {
    const { data } = await db.from('commission_plans').select('*').eq('id', partner.default_commission_plan_id).maybeSingle()
    if (data) return data as PlanRow
  }
  const { data } = await db.from('commission_plans').select('*').is('partner_id', null).eq('active', true).order('created_at', { ascending: true }).limit(1).maybeSingle()
  return (data as PlanRow) || null
}

/** Resolve the effective percentage, applying tiers (by paid-customer count / cumulative volume). */
async function resolvePct(db: Db, plan: PlanRow, partnerId: string): Promise<number> {
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

function periodOf(invoice: Stripe.Invoice): { start: string | null; end: string | null } {
  const line = invoice.lines?.data?.[0]
  const p = line?.period
  return { start: p?.start ? new Date(p.start * 1000).toISOString().slice(0, 10) : null, end: p?.end ? new Date(p.end * 1000).toISOString().slice(0, 10) : null }
}

/**
 * Record commission for a paid invoice. Handles the first payment (conversion: mark paid + bounty +
 * first recurring + bonuses), recurring cycles, and proration/expansion. Idempotent per invoice.
 */
export async function recordCommissionForInvoice(invoice: Stripe.Invoice, tenant: { id: string }): Promise<void> {
  try {
    const db = createAdminClient()
    const ref = await getReferralForTenant(db, tenant.id)
    if (!ref) return
    const plan = await getPlan(db, ref)
    if (!plan) return
    const currency = invoice.currency || plan.currency || 'usd'
    const gross = invoice.amount_paid || 0
    const reason = invoice.billing_reason || ''
    const { start, end } = periodOf(invoice)

    const isFirst = reason === 'subscription_create'
    const isCycle = reason === 'subscription_cycle'
    const isUpdate = reason === 'subscription_update'

    // Fixed-duration guard: stop recurring after duration_months from conversion.
    if ((isCycle) && plan.duration_months && ref.converted_at) {
      const months = (Date.now() - new Date(ref.converted_at).getTime()) / (1000 * 60 * 60 * 24 * 30.4)
      if (months > plan.duration_months) return
    }

    if (isFirst) {
      // Conversion moment.
      await db.from('referrals').update({ status: 'paid', converted_at: new Date().toISOString() }).eq('id', ref.id)
      await db.from('partner_notifications').insert({
        partner_id: ref.partner_id, kind: 'new_customer', title: 'Referred customer converted to paid',
        body: 'One of your referrals just started a paid subscription.', link: '/partner/commissions',
      })
      await logPartnerAction(ref.partner_id, 'system', { action: 'referral.paid', targetType: 'tenant', targetId: tenant.id })
      // XP: one grant per converted customer (idempotent on the referral).
      await awardXp(ref.partner_id, 'customer_paid', XP.customer_paid, { uniqueKey: `customer_paid:${ref.id}` })
      // Demo → paid: close the loop on the exact demo that sourced this customer.
      if (ref.demo_id) {
        await db.from('demos').update({ converted_paid: true }).eq('id', ref.demo_id)
        await db.from('demo_events').insert({ demo_id: ref.demo_id, partner_id: ref.partner_id, event_type: 'paid', meta: { tenant_id: tenant.id } }).then(() => {}, () => {})
      }
      // Conversion email to the partner (best-effort).
      try {
        const { data: partner } = await db.from('partners').select('contact_email, company_name').eq('id', ref.partner_id).maybeSingle()
        if (partner?.contact_email) {
          const tmpl = emailTemplates.partnerConversion(partner.company_name || 'there', `${PARTNER_APP_URL}/partner/commissions`)
          await sendEmail(partner.contact_email, tmpl.subject, tmpl.html)
        }
      } catch { /* best-effort */ }

      if (plan.one_time_cents && plan.one_time_cents > 0) {
        await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: tenant.id, plan_id: plan.id, entry_type: 'one_time', amount_cents: plan.one_time_cents, currency, source_event: 'invoice.payment_succeeded', source_ref: invoice.id, idempotency_key: `onetime:${ref.id}` })
      }
      if (plan.model !== 'one_time') {
        const pct = await resolvePct(db, plan, ref.partner_id)
        const amount = Math.round(gross * pct / 100)
        if (amount > 0) await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: tenant.id, plan_id: plan.id, entry_type: 'recurring', amount_cents: amount, currency, source_event: 'invoice.payment_succeeded', source_ref: invoice.id, period_start: start, period_end: end, idempotency_key: `recurring:${invoice.id}` })
      }
      await applyBonuses(db, ref, currency)
    } else if (isCycle && plan.model !== 'one_time') {
      const pct = await resolvePct(db, plan, ref.partner_id)
      const amount = Math.round(gross * pct / 100)
      if (amount > 0) await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: tenant.id, plan_id: plan.id, entry_type: 'recurring', amount_cents: amount, currency, source_event: 'invoice.payment_succeeded', source_ref: invoice.id, period_start: start, period_end: end, idempotency_key: `recurring:${invoice.id}` })
    } else if (isUpdate && plan.model !== 'one_time') {
      // Proration on an upgrade = expansion revenue.
      const pct = await resolvePct(db, plan, ref.partner_id)
      const amount = Math.round(gross * pct / 100)
      if (amount > 0) await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: tenant.id, plan_id: plan.id, entry_type: 'expansion', amount_cents: amount, currency, source_event: 'invoice.payment_succeeded', source_ref: invoice.id, period_start: start, period_end: end, idempotency_key: `expansion:${invoice.id}` })
    }
  } catch (e) {
    console.error('[commission] invoice handling failed:', (e as Error).message)
  }
}

async function applyBonuses(db: Db, ref: ReferralRow, currency: string): Promise<void> {
  const now = new Date().toISOString()
  const { data: campaigns } = await db.from('bonus_campaigns').select('*')
    .eq('active', true).in('kind', ['signup_bounty', 'conversion_bounty'])
    .or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`)
  for (const c of campaigns || []) {
    if (c.partner_type) {
      const { data: p } = await db.from('partners').select('partner_type').eq('id', ref.partner_id).maybeSingle()
      if (p?.partner_type !== c.partner_type) continue
    }
    if (c.amount_cents) {
      await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: ref.tenant_id, campaign_id: c.id, entry_type: 'bonus', amount_cents: c.amount_cents, currency, source_event: 'bonus_campaign', source_ref: c.id, idempotency_key: `bonus:${c.id}:${ref.id}` })
    }
  }
}

/**
 * Record churn on a cancelled subscription: mark the referral churned and, if inside the plan's
 * clawback window, reverse the one-time bounty (negative offsetting entry).
 */
export async function recordChurn(subscription: Stripe.Subscription, tenant: { id: string }): Promise<void> {
  try {
    const db = createAdminClient()
    const ref = await getReferralForTenant(db, tenant.id)
    if (!ref) return
    await db.from('referrals').update({ status: 'churned' }).eq('id', ref.id)
    await logPartnerAction(ref.partner_id, 'system', { action: 'referral.churned', targetType: 'tenant', targetId: tenant.id })

    const plan = await getPlan(db, ref)
    const withinWindow = plan?.clawback_window_days != null && ref.converted_at &&
      (Date.now() - new Date(ref.converted_at).getTime()) < plan.clawback_window_days * 24 * 60 * 60 * 1000
    if (!withinWindow) return

    // Reverse the one-time bounty if one was paid/pending and not already clawed back.
    const { data: bounty } = await db.from('commission_entries').select('amount_cents, currency')
      .eq('referral_id', ref.id).eq('entry_type', 'one_time').maybeSingle()
    if (bounty?.amount_cents) {
      await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: tenant.id, entry_type: 'clawback', amount_cents: -Math.abs(bounty.amount_cents), currency: bounty.currency || 'usd', source_event: 'customer.subscription.deleted', source_ref: subscription.id, idempotency_key: `clawback:${subscription.id}` })
    }
  } catch (e) {
    console.error('[commission] churn handling failed:', (e as Error).message)
  }
}

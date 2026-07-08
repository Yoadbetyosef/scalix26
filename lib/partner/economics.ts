import { createAdminClient } from '@/lib/supabase/server'
import { logPartnerAction } from '@/lib/partner/audit'
import { awardXp, XP } from '@/lib/partner/xp'
import { sendEmail, emailTemplates } from '@/lib/email/send'
import {
  insertEntry, getReferralForTenant, getEffectivePlan, resolvePct, evaluatePromotions,
  type Db, type ReferralRow, type PlanRow,
} from '@/lib/partner/commission'

const PARTNER_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.scalix26.com'

export type BillingEventType =
  | 'trial_started' | 'converted_paid' | 'renewed' | 'plan_upgraded' | 'plan_downgraded'
  | 'refunded' | 'chargeback' | 'cancelled' | 'manual_adjustment'

export interface RecordEventInput {
  tenantId: string
  type: BillingEventType
  amountCents?: number
  currency?: string
  source?: 'stripe' | 'manual' | 'system'
  sourceRef?: string
  idempotencyKey: string
  occurredAt?: string
  props?: Record<string, unknown>
}

/**
 * Record a billing event (idempotent) and process it into the ledger. THE single entry point for
 * all commission generation — every commission_entry.source_event_id traces back to a row here.
 */
export async function recordBillingEvent(input: RecordEventInput): Promise<void> {
  try {
    const db = createAdminClient()
    const ref = await getReferralForTenant(db, input.tenantId)
    const { data: ev } = await db.from('billing_events').upsert({
      tenant_id: input.tenantId,
      partner_id: ref?.partner_id || null,
      referral_id: ref?.id || null,
      event_type: input.type,
      amount_cents: input.amountCents || 0,
      currency: input.currency || 'usd',
      source: input.source || 'stripe',
      source_ref: input.sourceRef || null,
      idempotency_key: input.idempotencyKey,
      props: input.props || {},
      occurred_at: input.occurredAt || new Date().toISOString(),
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true }).select('id').maybeSingle()
    if (!ev) return                          // duplicate event → already processed
    if (!ref) { await markProcessed(db, ev.id); return }  // unattributed → logged for audit only
    await processBillingEvent(db, ev.id, ref, input)
  } catch (e) {
    console.error('[economics] recordBillingEvent failed:', (e as Error).message)
  }
}

async function markProcessed(db: Db, id: string, error?: string) {
  await db.from('billing_events').update({ processed_at: new Date().toISOString(), process_error: error || null }).eq('id', id)
}

async function processBillingEvent(db: Db, eventId: string, ref: ReferralRow, input: RecordEventInput): Promise<void> {
  try {
    // Reseller partners are billed wholesale by Scalix — events route to reseller invoicing, not the
    // commission ledger. Engine built at the first reseller deal; for now record the intent line.
    const { data: partner } = await db.from('partners').select('billing_mode').eq('id', ref.partner_id).maybeSingle()
    if (partner?.billing_mode === 'reseller') { await recordResellerLine(db, eventId, ref, input); await markProcessed(db, eventId); return }

    const plan = await getEffectivePlan(db, ref)
    if (!plan) { await markProcessed(db, eventId, 'no plan'); return }
    const currency = input.currency || plan.currency || 'usd'
    const gross = input.amountCents || 0
    const sref = input.sourceRef || eventId

    switch (input.type) {
      case 'trial_started':
        await db.from('referrals').update({ status: 'trial' }).eq('id', ref.id).eq('status', 'signup')
        await evaluatePromotions(db, ref, 'trial_started', currency)
        break

      case 'converted_paid':
        await onConverted(db, eventId, ref, plan, gross, currency, sref)
        break

      case 'renewed': {
        if (plan.model === 'one_time') break
        if (plan.duration_months && ref.converted_at) {
          const months = (Date.now() - new Date(ref.converted_at).getTime()) / (1000 * 60 * 60 * 24 * 30.4)
          if (months > plan.duration_months) break
        }
        const pct = await resolvePct(db, plan, ref.partner_id)
        const amount = Math.round(gross * pct / 100)
        if (amount > 0) await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: ref.tenant_id, plan_id: plan.id, entry_type: 'recurring', amount_cents: amount, currency, source_event: input.type, source_ref: sref, source_event_id: eventId, idempotency_key: `recurring:${sref}` })
        break
      }

      case 'plan_upgraded': {
        if (plan.model === 'one_time') break
        const pct = await resolvePct(db, plan, ref.partner_id)
        const amount = Math.round(gross * pct / 100)
        if (amount > 0) await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: ref.tenant_id, plan_id: plan.id, entry_type: 'expansion', amount_cents: amount, currency, source_event: input.type, source_ref: sref, source_event_id: eventId, idempotency_key: `expansion:${sref}` })
        break
      }

      case 'plan_downgraded': {
        const pct = await resolvePct(db, plan, ref.partner_id)
        const amount = Math.round(gross * pct / 100)
        if (amount > 0) await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: ref.tenant_id, plan_id: plan.id, entry_type: 'expansion', amount_cents: -amount, currency, source_event: input.type, source_ref: sref, source_event_id: eventId, idempotency_key: `contraction:${sref}` })
        break
      }

      case 'refunded':
      case 'chargeback': {
        const pct = await resolvePct(db, plan, ref.partner_id)
        const amount = Math.round(gross * pct / 100)
        if (amount > 0) await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: ref.tenant_id, plan_id: plan.id, entry_type: 'clawback', amount_cents: -amount, currency, source_event: input.type, source_ref: sref, source_event_id: eventId, idempotency_key: `clawback:${input.type}:${sref}` })
        break
      }

      case 'cancelled':
        await onCancelled(db, eventId, ref, plan, sref)
        break
    }
    await markProcessed(db, eventId)
  } catch (e) {
    await markProcessed(db, eventId, (e as Error).message)
    console.error('[economics] process failed:', (e as Error).message)
  }
}

async function onConverted(db: Db, eventId: string, ref: ReferralRow, plan: PlanRow, gross: number, currency: string, sref: string): Promise<void> {
  await db.from('referrals').update({ status: 'paid', converted_at: new Date().toISOString() }).eq('id', ref.id)
  await db.from('partner_notifications').insert({ partner_id: ref.partner_id, kind: 'new_customer', title: 'Referred customer converted to paid', body: 'One of your referrals just started a paid subscription.', link: '/partner/commissions' })
  await logPartnerAction(ref.partner_id, 'system', { action: 'referral.paid', targetType: 'tenant', targetId: ref.tenant_id })
  await awardXp(ref.partner_id, 'customer_paid', XP.customer_paid, { uniqueKey: `customer_paid:${ref.id}` })
  if (ref.demo_id) {
    await db.from('demos').update({ converted_paid: true }).eq('id', ref.demo_id)
    await db.from('demo_events').insert({ demo_id: ref.demo_id, partner_id: ref.partner_id, event_type: 'paid', meta: { tenant_id: ref.tenant_id } }).then(() => {}, () => {})
  }
  try {
    const { data: p } = await db.from('partners').select('contact_email, company_name').eq('id', ref.partner_id).maybeSingle()
    if (p?.contact_email) { const t = emailTemplates.partnerConversion(p.company_name || 'there', `${PARTNER_APP_URL}/partner/commissions`); await sendEmail(p.contact_email, t.subject, t.html) }
  } catch { /* best-effort */ }
  if (plan.one_time_cents && plan.one_time_cents > 0) {
    await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: ref.tenant_id, plan_id: plan.id, entry_type: 'one_time', amount_cents: plan.one_time_cents, currency, source_event: 'converted_paid', source_ref: sref, source_event_id: eventId, idempotency_key: `onetime:${ref.id}` })
  }
  if (plan.model !== 'one_time') {
    const pct = await resolvePct(db, plan, ref.partner_id)
    const amount = Math.round(gross * pct / 100)
    if (amount > 0) await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: ref.tenant_id, plan_id: plan.id, entry_type: 'recurring', amount_cents: amount, currency, source_event: 'converted_paid', source_ref: sref, source_event_id: eventId, idempotency_key: `recurring:${sref}` })
  }
  await evaluatePromotions(db, ref, 'converted_paid', currency)
}

async function onCancelled(db: Db, eventId: string, ref: ReferralRow, plan: PlanRow, sref: string): Promise<void> {
  await db.from('referrals').update({ status: 'churned' }).eq('id', ref.id)
  await logPartnerAction(ref.partner_id, 'system', { action: 'referral.churned', targetType: 'tenant', targetId: ref.tenant_id })
  const within = plan.clawback_window_days != null && ref.converted_at &&
    (Date.now() - new Date(ref.converted_at).getTime()) < plan.clawback_window_days * 24 * 60 * 60 * 1000
  if (!within) return
  const { data: bounty } = await db.from('commission_entries').select('amount_cents, currency').eq('referral_id', ref.id).eq('entry_type', 'one_time').maybeSingle()
  if (bounty?.amount_cents) {
    await insertEntry(db, { partner_id: ref.partner_id, referral_id: ref.id, tenant_id: ref.tenant_id, entry_type: 'clawback', amount_cents: -Math.abs(bounty.amount_cents), currency: bounty.currency || 'usd', source_event: 'cancelled', source_ref: sref, source_event_id: eventId, idempotency_key: `clawback:cancel:${sref}` })
  }
}

async function recordResellerLine(db: Db, eventId: string, ref: ReferralRow, input: RecordEventInput): Promise<void> {
  if (input.type !== 'converted_paid' && input.type !== 'renewed') return
  await db.from('reseller_invoice_lines').insert({
    partner_id: ref.partner_id, billing_event_id: eventId, tenant_id: ref.tenant_id,
    amount_cents: input.amountCents || 0, description: `${input.type} (wholesale — pending invoicing engine)`,
  }).then(() => {}, () => {})
}

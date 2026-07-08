import { createAdminClient } from '@/lib/supabase/server'
import { payPartnerViaConnect, getExpressStatus } from '@/lib/partner/connect'
import { sendEmail, emailTemplates } from '@/lib/email/send'

const PARTNER_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.scalix26.com'
const money = (c: number, cur = 'usd') => (c / 100).toLocaleString('en-US', { style: 'currency', currency: cur.toUpperCase() })

export interface PayoutResult { ok: boolean; status?: 'paid' | 'failed'; method?: 'stripe_connect' | 'manual'; amount_cents?: number; error?: string }

/**
 * Pay out a partner's approved commission balance. If their Stripe Connect Express account has
 * payouts enabled, transfers automatically; otherwise records a manual payout. On a Stripe failure
 * the entries stay 'approved' (unpaid) and a 'failed' payout is recorded for retry. Idempotent-ish:
 * only bundles entries not already linked to a payout.
 */
export async function executePayout(partnerId: string, opts?: { by?: string; requireConnect?: boolean; minCents?: number }): Promise<PayoutResult> {
  const db = createAdminClient()
  const now = new Date().toISOString()

  const { data: approved } = await db.from('commission_entries').select('id, amount_cents, currency')
    .eq('partner_id', partnerId).eq('status', 'approved').is('payout_id', null)
  const entries = approved || []
  const total = entries.reduce((s, e) => s + e.amount_cents, 0)
  if (!entries.length || total <= 0) return { ok: false, error: 'No approved commission to pay.' }
  if (opts?.minCents && total < opts.minCents) return { ok: false, error: 'Below minimum payout threshold.' }
  const currency = entries[0].currency || 'usd'

  const status = await getExpressStatus(partnerId)
  const canAuto = status.connected && status.payoutsEnabled
  if (opts?.requireConnect && !canAuto) return { ok: false, error: 'Partner payouts not enabled.' }

  const transfer = canAuto ? await payPartnerViaConnect(partnerId, total, currency) : { ok: false, error: 'manual' }

  // Stripe attempted but failed → record a failed payout, keep entries approved.
  if (canAuto && !transfer.ok) {
    await db.from('payouts').insert({ partner_id: partnerId, amount_cents: total, currency, method: 'stripe_connect', status: 'failed', last_error: transfer.error || 'transfer failed', created_by: opts?.by || 'system', updated_at: now })
    await db.from('partner_notifications').insert({ partner_id: partnerId, kind: 'payout_failed', title: 'Payout failed', body: 'We could not complete your payout — it will be retried automatically.', link: '/partner/commissions' })
    return { ok: false, status: 'failed', error: transfer.error || 'Transfer failed.' }
  }

  // Success (auto transfer) or manual record.
  const { data: payout } = await db.from('payouts').insert({
    partner_id: partnerId, amount_cents: total, currency,
    method: canAuto ? 'stripe_connect' : 'manual', status: 'paid',
    stripe_transfer_id: transfer.ok ? transfer.transferId : null, created_by: opts?.by || 'system', paid_at: now, updated_at: now,
  }).select('id').single()
  await db.from('commission_entries').update({ status: 'paid', paid_at: now, payout_id: payout!.id }).in('id', entries.map((e) => e.id))
  await db.from('partner_notifications').insert({ partner_id: partnerId, kind: 'payout_sent', title: 'Payout sent', body: `A payout of ${money(total, currency)} was issued.`, link: '/partner/commissions' })

  try {
    const { data: partner } = await db.from('partners').select('contact_email, company_name').eq('id', partnerId).maybeSingle()
    if (partner?.contact_email) {
      const t = emailTemplates.partnerPayout(partner.company_name || 'there', total, currency, `${PARTNER_APP_URL}/partner/commissions`)
      await sendEmail(partner.contact_email, t.subject, t.html)
    }
  } catch { /* best-effort */ }

  return { ok: true, status: 'paid', method: canAuto ? 'stripe_connect' : 'manual', amount_cents: total }
}

/** Auto-payout run for the cron: every connect-enabled partner with balance ≥ threshold. */
export async function autoPayoutRun(minCents = Number(process.env.PARTNER_MIN_PAYOUT_CENTS) || 5000): Promise<number> {
  const db = createAdminClient()
  const { data: partners } = await db.from('partners').select('id').eq('status', 'active').eq('connect_payouts_enabled', true)
  let paid = 0
  for (const p of partners || []) {
    const res = await executePayout(p.id, { by: 'auto', requireConnect: true, minCents })
    if (res.ok) paid++
  }
  return paid
}

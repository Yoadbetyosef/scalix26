import { NextRequest, NextResponse } from 'next/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/admin/audit'
import { sendEmail, emailTemplates } from '@/lib/email/send'
import { payPartnerViaConnect } from '@/lib/partner/connect'

const PARTNER_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.scalix26.com'

// Admin commission operations:
//  action=approve   → move a partner's pending entries to approved.
//  action=pay       → bundle approved entries into a payout (status paid). v1 = manual/CSV record.
export async function POST(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { partnerId, action } = await req.json().catch(() => ({}))
  if (!partnerId || !action) return NextResponse.json({ error: 'partnerId and action required' }, { status: 400 })
  const db = createAdminClient()
  const now = new Date().toISOString()

  if (action === 'approve') {
    const { error } = await db.from('commission_entries').update({ status: 'approved', approved_at: now })
      .eq('partner_id', partnerId).eq('status', 'pending')
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await logAdminAction(ctx.email, { action: 'commission.approve', targetType: 'partner', targetId: partnerId })
    return NextResponse.json({ success: true })
  }

  if (action === 'pay') {
    const { data: approved } = await db.from('commission_entries').select('id, amount_cents, currency')
      .eq('partner_id', partnerId).eq('status', 'approved').is('payout_id', null)
    const entries = approved || []
    const total = entries.reduce((s, e) => s + e.amount_cents, 0)
    if (!entries.length || total <= 0) return NextResponse.json({ error: 'No approved commission to pay.' }, { status: 400 })
    const currency = entries[0].currency || 'usd'

    // Try an automated Stripe Connect transfer; fall back to a manual record.
    const transfer = await payPartnerViaConnect(partnerId, total, currency)

    const { data: payout, error } = await db.from('payouts').insert({
      partner_id: partnerId, amount_cents: total, currency,
      method: transfer.ok ? 'stripe_connect' : 'manual', status: 'paid',
      stripe_transfer_id: transfer.transferId || null, created_by: ctx.email, paid_at: now,
    }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await db.from('commission_entries').update({ status: 'paid', paid_at: now, payout_id: payout.id })
      .in('id', entries.map((e) => e.id))
    await db.from('partner_notifications').insert({ partner_id: partnerId, kind: 'payout_sent', title: 'Payout sent 💸', body: `A payout of ${(total / 100).toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase() })} was issued.`, link: '/partner/commissions' })

    // Payout email (best-effort).
    try {
      const { data: partner } = await db.from('partners').select('contact_email, company_name').eq('id', partnerId).maybeSingle()
      if (partner?.contact_email) {
        const tmpl = emailTemplates.partnerPayout(partner.company_name || 'there', total, currency, `${PARTNER_APP_URL}/partner/commissions`)
        await sendEmail(partner.contact_email, tmpl.subject, tmpl.html)
      }
    } catch { /* best-effort */ }

    await logAdminAction(ctx.email, { action: 'commission.pay', targetType: 'partner', targetId: partnerId, after: { amount_cents: total, payout_id: payout.id, method: transfer.ok ? 'stripe_connect' : 'manual' } })
    return NextResponse.json({ success: true, amount_cents: total, method: transfer.ok ? 'stripe_connect' : 'manual' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

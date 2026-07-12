import { NextRequest, NextResponse } from 'next/server'
import { getPartnerContext } from '@/lib/partner/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { requestBaseUrl } from '@/lib/request-url'
import { getPartnerBalanceSummary } from '@/lib/billing/summary'
import { createTopupCheckout, createSetupCheckout, isValidTopupAmount } from '@/lib/billing/topup'

export async function GET() {
  const ctx = await getPartnerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await getPartnerBalanceSummary(ctx.partnerId))
}

export async function POST(req: NextRequest) {
  const ctx = await getPartnerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const action = b.action as string
  const baseUrl = requestBaseUrl(req)

  // Add funds → Stripe Checkout (saves the card for auto-reload). Amount must be a preset or a valid custom.
  if (action === 'topup') {
    const amount = Number(b.amountCents)
    if (!isValidTopupAmount(amount)) return NextResponse.json({ error: 'Enter an amount between $50 and $20,000.' }, { status: 400 })
    const { url } = await createTopupCheckout(ctx.partnerId, amount, baseUrl)
    return NextResponse.json({ url })
  }

  // Save / update the card (no charge) — needed to enable auto-reload.
  if (action === 'add_card') {
    const { url } = await createSetupCheckout(ctx.partnerId, baseUrl)
    return NextResponse.json({ url })
  }

  // Configure automatic reload.
  if (action === 'auto_reload') {
    const enabled = !!b.enabled
    const db = createAdminClient()
    if (!enabled) {
      await db.from('partner_balances').update({ auto_reload_enabled: false }).eq('partner_id', ctx.partnerId)
      return NextResponse.json({ ok: true })
    }
    const threshold = Number(b.thresholdCents)
    const amount = Number(b.amountCents)
    if (!Number.isInteger(threshold) || threshold < 0) return NextResponse.json({ error: 'Invalid reload threshold.' }, { status: 400 })
    if (!isValidTopupAmount(amount)) return NextResponse.json({ error: 'Reload amount must be between $50 and $20,000.' }, { status: 400 })
    // A saved card is required to charge off-session.
    const { data: bal } = await db.from('partner_balances').select('stripe_payment_method_id').eq('partner_id', ctx.partnerId).maybeSingle()
    if (!bal?.stripe_payment_method_id) return NextResponse.json({ error: 'Add a payment method first.', needsCard: true }, { status: 400 })
    await db.from('partner_balances').upsert({
      partner_id: ctx.partnerId, auto_reload_enabled: true,
      auto_reload_threshold_cents: threshold, auto_reload_amount_cents: amount,
    }, { onConflict: 'partner_id' })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { createServiceClient } from '@/lib/supabase/server'
import { syncConnectFromAccount } from '@/lib/stripe/connect'
import { syncPartnerConnectFromAccount, handlePartnerTransferFailure } from '@/lib/partner/connect'

// SEPARATE Connect webhook (its own STRIPE_CONNECT_WEBHOOK_SECRET) — the platform
// billing webhook (/api/webhooks/stripe + STRIPE_WEBHOOK_SECRET) is untouched.
// Connected-account events arrive with event.account = acct_…
export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  let event
  try {
    event = stripe.webhooks.constructEvent(body, signature || '', process.env.STRIPE_CONNECT_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = await createServiceClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      const pi = typeof session.payment_intent === 'string' ? session.payment_intent : null
      await supabase.from('payments')
        .update({ status: 'paid', paid_at: new Date().toISOString(), payment_intent_id: pi })
        .eq('checkout_session_id', session.id)
        .neq('status', 'paid')
      console.log('[stripe-connect-webhook] checkout.session.completed', session.id, '| acct', event.account)
      break
    }

    case 'payment_intent.succeeded': {
      const pi = event.data.object
      await supabase.from('payments')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('payment_intent_id', pi.id)
        .neq('status', 'paid')
      break
    }

    case 'account.updated': {
      // A partner Express account? Sync partner payout status. Otherwise it's a tenant account.
      const acct = event.data.object
      const isPartner = await syncPartnerConnectFromAccount(acct)
      if (!isPartner) await syncConnectFromAccount(acct)
      break
    }

    case 'transfer.reversed': {
      // A partner payout transfer was reversed — revert entries + mark the payout failed for retry.
      // (Synchronous transfer failures are already handled at creation time in executePayout.)
      const tr = event.data.object as { id: string }
      await handlePartnerTransferFailure(tr.id, `Stripe ${event.type}`)
      break
    }
  }

  return NextResponse.json({ received: true })
}

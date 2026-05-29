import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { createServiceClient } from '@/lib/supabase/server'
import { provisionTenantPhoneNumber } from '@/lib/twilio/provision'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')!

  let event
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = await createServiceClient()

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object
      const planMap: Record<string, string> = {
        [process.env.STRIPE_STARTER_PRICE_ID!]: 'starter',
        [process.env.STRIPE_PRO_PRICE_ID!]: 'pro',
        [process.env.STRIPE_BUSINESS_PRICE_ID!]: 'business',
      }
      const priceId = sub.items.data[0]?.price.id
      const plan = planMap[priceId] || 'starter'

      await supabase
        .from('tenants')
        .update({
          plan,
          stripe_subscription_id: sub.id,
        })
        .eq('stripe_customer_id', sub.customer)
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object
      await supabase
        .from('tenants')
        .update({ plan: 'trial' })
        .eq('stripe_customer_id', sub.customer)
      break
    }

    case 'checkout.session.completed': {
      const session = event.data.object
      if (session.customer && session.metadata?.tenantId) {
        await supabase
          .from('tenants')
          .update({ stripe_customer_id: session.customer })
          .eq('id', session.metadata.tenantId)

        // Auto-provision a dedicated phone number for this tenant
        provisionTenantPhoneNumber(session.metadata.tenantId).catch(err =>
          console.error('[provision] Failed to provision phone number:', err)
        )
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}

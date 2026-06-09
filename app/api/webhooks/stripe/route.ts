import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { createServiceClient } from '@/lib/supabase/server'
import { provisionTenantPhoneNumber } from '@/lib/twilio/provision'
import { sendEmail, emailTemplates } from '@/lib/email/send'
import { notifyAdminPaymentFailed } from '@/lib/admin/notify'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.mylocksmithai.com'

async function getTenantByCustomer(supabase: Awaited<ReturnType<typeof createServiceClient>>, customerId: string) {
  const { data } = await supabase.from('tenants').select('*').eq('stripe_customer_id', customerId).single()
  return data
}

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
        .update({ plan, stripe_subscription_id: sub.id })
        .eq('stripe_customer_id', sub.customer)
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object
      const tenant = await getTenantByCustomer(supabase, sub.customer as string)
      await supabase.from('tenants').update({ plan: 'trial' }).eq('stripe_customer_id', sub.customer)
      if (tenant) {
        const tmpl = emailTemplates.subscriptionCancelled(tenant.business_name)
        await sendEmail(tenant.email, tmpl.subject, tmpl.html)
      }
      break
    }

    case 'checkout.session.completed': {
      const session = event.data.object
      if (session.customer && session.metadata?.tenantId) {
        await supabase
          .from('tenants')
          .update({ stripe_customer_id: session.customer })
          .eq('id', session.metadata.tenantId)
        provisionTenantPhoneNumber(session.metadata.tenantId).catch(err =>
          console.error('[provision] Failed to provision phone number:', err)
        )
      }
      break
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object
      if (!invoice.customer) break
      const tenant = await getTenantByCustomer(supabase, invoice.customer as string)
      if (!tenant) break
      const amount = invoice.amount_paid || 0
      const date = new Date(invoice.created * 1000).toLocaleDateString()
      const tmpl = emailTemplates.paymentSuccess(tenant.business_name, amount, date)
      await sendEmail(tenant.email, tmpl.subject, tmpl.html)
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object
      if (!invoice.customer) break
      const tenant = await getTenantByCustomer(supabase, invoice.customer as string)
      if (!tenant) break

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: invoice.customer as string,
        return_url: `${APP_URL}/settings`,
      }).catch(() => null)

      const updateUrl = portalSession?.url || `${APP_URL}/settings`
      const amount = invoice.amount_due || 0

      // Email customer
      const customerTmpl = emailTemplates.paymentFailed(tenant.business_name, updateUrl)
      await sendEmail(tenant.email, customerTmpl.subject, customerTmpl.html)

      // Notify admin
      await notifyAdminPaymentFailed({
        name: tenant.business_name,
        email: tenant.email,
        plan: tenant.plan,
        amount,
      })

      // After 7 days Stripe retries automatically — on final failure, pause account
      const attemptCount = invoice.attempt_count || 1
      if (attemptCount >= 3) {
        await supabase.from('tenants').update({ plan: 'trial' }).eq('id', tenant.id)
      }
      break
    }

    case 'payment_method.updated': {
      // Card updated — notify customer
      const pm = event.data.object
      if (!pm.customer) break
      const tenant = await getTenantByCustomer(supabase, pm.customer as string)
      if (!tenant) break
      const tmpl = emailTemplates.cardUpdated(tenant.business_name)
      await sendEmail(tenant.email, tmpl.subject, tmpl.html)
      break
    }
  }

  return NextResponse.json({ received: true })
}

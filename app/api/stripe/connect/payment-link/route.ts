import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { getConnectedAccountId } from '@/lib/stripe/connect'
import { sendEmail } from '@/lib/email/send'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || ''

// POST { lead_token, price_id, customer_email?, customer_phone?, conversation_id?, contact_id? }
// Creates a Checkout Session on the tenant's CONNECTED account for the chosen price and
// returns its URL. Tenant is resolved from the secret lead token (same pattern as the
// booking endpoints). NO application_fee — funds go directly to the tenant.
export async function POST(req: NextRequest) {
  const data = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leadToken = typeof data.lead_token === 'string' ? data.lead_token : ''
  const priceId = typeof data.price_id === 'string' ? data.price_id : ''
  const customerEmail = typeof data.customer_email === 'string' && data.customer_email.trim() ? data.customer_email.trim() : null
  const customerPhone = typeof data.customer_phone === 'string' && data.customer_phone.trim() ? data.customer_phone.trim() : null
  const conversationId = typeof data.conversation_id === 'string' ? data.conversation_id : null
  const contactId = typeof data.contact_id === 'string' ? data.contact_id : null

  if (!leadToken || !priceId) return NextResponse.json({ error: 'lead_token and price_id required' }, { status: 400 })

  const supabase = await createServiceClient()
  const { data: tenant } = await supabase.from('tenants').select('id, business_name').eq('lead_intake_token', leadToken).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'invalid token' }, { status: 404 })

  const acct = await getConnectedAccountId(tenant.id)
  if (!acct) return NextResponse.json({ error: 'Payments are not set up for this business yet.' }, { status: 409 })

  // Validate the price actually belongs to the tenant's connected account — never charge
  // a price the AI invented or one from another account.
  let price: Stripe.Price
  try {
    price = await stripe.prices.retrieve(priceId, { expand: ['product'] }, { stripeAccount: acct })
  } catch {
    return NextResponse.json({ error: 'That product is not available.' }, { status: 400 })
  }
  if (!price || price.active === false) return NextResponse.json({ error: 'That product is not available.' }, { status: 400 })
  const product = price.product
  const productName = typeof product === 'object' && product !== null && !('deleted' in product && product.deleted)
    ? ((product as Stripe.Product).name || 'Payment')
    : 'Payment'

  // Checkout Session on the CONNECTED account — money goes straight to the tenant.
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: customerEmail || undefined,
    success_url: `${APP_URL}/?payment=success`,
    cancel_url: `${APP_URL}/?payment=cancelled`,
    metadata: { tenantId: tenant.id, conversationId: conversationId || '', contactId: contactId || '', priceId },
  }, { stripeAccount: acct })

  // Record a pending payment (marked paid by the Connect webhook).
  await supabase.from('payments').insert({
    tenant_id: tenant.id,
    connected_account_id: acct,
    checkout_session_id: session.id,
    price_id: priceId,
    product_name: productName,
    amount: price.unit_amount ?? null,
    currency: price.currency,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    conversation_id: conversationId,
    contact_id: contactId,
    status: 'pending',
  })

  // Deliver via email now (SMS stays gated behind A2P — the AI includes the link in its
  // in-channel reply for SMS until then).
  if (customerEmail && session.url) {
    try {
      const biz = tenant.business_name || 'us'
      await sendEmail(
        customerEmail,
        `Your payment link from ${biz}`,
        `<p>Here's your secure payment link for <strong>${productName}</strong>:</p><p><a href="${session.url}">${session.url}</a></p><p>— ${biz}</p>`,
      )
    } catch (e) {
      console.error('[payment-link] email send failed:', e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({ url: session.url, productName, emailed: !!customerEmail })
}

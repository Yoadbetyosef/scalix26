import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { getConnectedAccountId } from '@/lib/stripe/connect'
import { resolvePaymentAgent, isPaymentCollectionActive, computeDeposit, createConnectCheckout } from '@/lib/stripe/payment-collection'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || ''

// POST { lead_token, price_id?, amount?, description?, customer_email?, customer_phone?,
//        conversation_id?, contact_id?, channel? }
// Called by the AI's send_payment_link tool. This route is the CHOKEPOINT that enforces the
// Payment Collection skill + owner approval (the fenced pipeline/booking files are not
// touched). Money always goes to the tenant's connected account — we never hold funds.
export async function POST(req: NextRequest) {
  const data = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leadToken = typeof data.lead_token === 'string' ? data.lead_token : ''
  const priceId = typeof data.price_id === 'string' && data.price_id.trim() ? data.price_id.trim() : ''
  const customAmount = typeof data.amount === 'number' && data.amount > 0 ? Math.round(data.amount) : null // minor units
  const description = typeof data.description === 'string' ? data.description.slice(0, 200) : ''
  const customerEmail = typeof data.customer_email === 'string' && data.customer_email.trim() ? data.customer_email.trim() : null
  const customerPhone = typeof data.customer_phone === 'string' && data.customer_phone.trim() ? data.customer_phone.trim() : null
  const conversationId = typeof data.conversation_id === 'string' ? data.conversation_id : null
  const contactId = typeof data.contact_id === 'string' ? data.contact_id : null
  const channel = typeof data.channel === 'string' ? data.channel : null

  if (!leadToken || (!priceId && !customAmount)) {
    return NextResponse.json({ error: 'lead_token and price_id (or amount) required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: tenant } = await admin.from('tenants').select('id, business_name').eq('lead_intake_token', leadToken).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'invalid token' }, { status: 404 })

  // Skill gate (behavior 2 & 3): the agent must have Payment Collection turned ON.
  const agent = await resolvePaymentAgent(admin, tenant.id, conversationId)
  if (!agent || !(await isPaymentCollectionActive(admin, agent.id))) {
    return NextResponse.json({ error: 'Payment collection is not enabled for this business.' }, { status: 403 })
  }
  const settings = agent.settings

  const acct = await getConnectedAccountId(tenant.id)
  if (!acct) return NextResponse.json({ error: 'Payments are not set up for this business yet.' }, { status: 409 })

  // Resolve what to charge — a real product price or a custom amount, each gated by settings.
  let kind: 'product' | 'custom' | 'deposit' = 'product'
  let productName = 'Payment'
  let chargeAmount: number | null = null // minor units to charge (deposit/custom); null = full product price
  let recordAmount: number | null = null

  if (priceId) {
    if (!settings.allow_products) return NextResponse.json({ error: 'Product payments are turned off.' }, { status: 403 })
    let price: Stripe.Price
    try {
      price = await stripe.prices.retrieve(priceId, { expand: ['product'] }, { stripeAccount: acct })
    } catch {
      return NextResponse.json({ error: 'That product is not available.' }, { status: 400 })
    }
    if (!price || price.active === false) return NextResponse.json({ error: 'That product is not available.' }, { status: 400 })
    const product = price.product
    productName = typeof product === 'object' && product !== null && !('deleted' in product && product.deleted)
      ? ((product as Stripe.Product).name || 'Payment') : 'Payment'
    recordAmount = price.unit_amount ?? null
    const dep = computeDeposit(settings, price.unit_amount ?? null)
    if (dep != null) { kind = 'deposit'; chargeAmount = dep; recordAmount = dep; productName = `Deposit — ${productName}` }
  } else if (customAmount) {
    if (!settings.allow_custom_amount) return NextResponse.json({ error: 'Custom amounts are turned off.' }, { status: 403 })
    kind = 'custom'; chargeAmount = customAmount; recordAmount = customAmount
    productName = description || 'Payment'
  }

  // Approval gate (behavior 4): create a PENDING request instead of charging.
  if (settings.require_approval) {
    const { data: pr } = await admin.from('payment_requests').insert({
      tenant_id: tenant.id, ai_employee_id: agent.id, conversation_id: conversationId, contact_id: contactId,
      customer_email: customerEmail, customer_phone: customerPhone, channel,
      kind, price_id: kind === 'custom' ? null : priceId, product_name: productName,
      amount: chargeAmount, currency: 'usd', description: description || null, status: 'pending', created_by: 'ai',
    }).select('id').single()
    console.log('[payment-link] pending approval request', pr?.id, '| tenant', tenant.id)
    return NextResponse.json({ pending: true, requestId: pr?.id, message: 'The business owner needs to approve this payment before the link is sent.' })
  }

  // No approval required (behavior 5): create the Checkout Session now.
  try {
    const co = await createConnectCheckout(admin, {
      tenantId: tenant.id, businessName: tenant.business_name || 'us', accountId: acct, appUrl: APP_URL,
      priceId: chargeAmount == null ? priceId : null, amount: chargeAmount, productName, recordAmount,
      customerEmail, customerPhone, conversationId, contactId,
    })
    console.log('[payment-link] created session', co.sessionId, '| tenant', tenant.id)
    return NextResponse.json({ url: co.url, productName, emailed: co.emailed })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not create a payment link' }, { status: 500 })
  }
}

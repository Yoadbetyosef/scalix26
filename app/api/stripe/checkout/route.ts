import { NextRequest, NextResponse } from 'next/server'
import { stripe, PLANS } from '@/lib/stripe/client'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Start a subscription Checkout. The client sends the PLAN KEY ('starter'|'pro'|'business') and the Stripe
// price is resolved SERVER-SIDE from PLANS (server env STRIPE_*_PRICE_ID). Previously the client read
// NEXT_PUBLIC_* price ids that were never set, so `priceId` was undefined and checkout silently failed.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in to upgrade.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const plan = typeof body?.plan === 'string' ? body.plan : null
  if (!plan || !(plan in PLANS)) return NextResponse.json({ error: 'Choose a plan to upgrade.' }, { status: 400 })
  const priceId = (PLANS as Record<string, { priceId?: string }>)[plan].priceId
  if (!priceId) {
    console.error(`[stripe/checkout] no price configured for plan "${plan}" (STRIPE_${plan.toUpperCase()}_PRICE_ID missing)`)
    return NextResponse.json({ error: 'Billing is not set up for this plan yet. Please contact support.' }, { status: 500 })
  }

  const serviceSupabase = await createServiceClient()
  const { data: tenant } = await serviceSupabase
    .from('tenants').select('id').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'No account found for your login.' }, { status: 404 })

  const origin = req.nextUrl.origin
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/settings?billing=success`,
      cancel_url: `${origin}/settings?billing=cancelled`,
      metadata: { tenantId: tenant.id, plan },
    })
    if (!session.url) return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
    return NextResponse.json({ url: session.url })
  } catch (e) {
    // TEMPORARY safe diagnostics (no secrets: priceId, origin, and Stripe error text are not sensitive).
    const err = e as { type?: string; code?: string; param?: string; message?: string; requestId?: string }
    console.error('[stripe/checkout] Stripe error', { type: err.type, code: err.code, param: err.param, requestId: err.requestId, message: err.message, plan, priceId, origin })
    return NextResponse.json({
      error: 'Could not start checkout. Please try again in a moment.',
      debug: { plan, priceId, origin, stripe_type: err.type, stripe_code: err.code, stripe_param: err.param, stripe_request_id: err.requestId, stripe_message: err.message },
    }, { status: 502 })
  }
}

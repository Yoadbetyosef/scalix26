import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { priceId } = await req.json()
  if (!priceId) return NextResponse.json({ error: 'Price ID required' }, { status: 400 })

  const serviceSupabase = await createServiceClient()
  const { data: tenant } = await serviceSupabase
    .from('tenants').select('*').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?billing=success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?billing=cancelled`,
    metadata: { tenantId: tenant.id },
  })

  return NextResponse.json({ url: session.url })
}

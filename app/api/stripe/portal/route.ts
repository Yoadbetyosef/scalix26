import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { createClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'

// BILLING IS THE OWNER'S. The `eq('user_id', ...)` lookup below already fails closed for a team
// member — she owns no tenant, so it finds nothing — but that is an accident of how the tenant is
// resolved, not a stated rule, and it would evaporate the moment someone switched this to the active
// workspace resolver. The explicit capability check is the rule; the lookup is just a lookup.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await requireActiveBusinessContext()
  if (!ctx?.capabilities.canEditBilling) {
    return NextResponse.json({ error: 'Only the business owner can manage billing.' }, { status: 403 })
  }

  const { data: tenant } = await supabase.from('tenants').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 400 })
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: tenant.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings`,
  })

  return NextResponse.json({ url: session.url })
}

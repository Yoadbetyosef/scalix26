import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveOwnerTenantId } from '@/lib/calendar/store'
import { getConnectedAccountId, listCatalog } from '@/lib/stripe/connect'

// GET → { products: [{ priceId, productName, unitAmount, currency, recurring }] }
// The tenant's active products/prices from their connected account.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await resolveOwnerTenantId(user.id)
  if (!tenantId) return NextResponse.json({ products: [] })

  const acct = await getConnectedAccountId(tenantId)
  if (!acct) return NextResponse.json({ connected: false, products: [] })

  try {
    const products = await listCatalog(acct)
    return NextResponse.json({ connected: true, products })
  } catch (err) {
    console.error('[stripe-connect/products] list failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ connected: true, products: [], error: 'Could not load your Stripe catalog.' }, { status: 502 })
  }
}

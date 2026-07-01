import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveOwnerTenantId } from '@/lib/calendar/store'
import { disconnectAccount } from '@/lib/stripe/connect'

// POST → deauthorize the connected Stripe account + clear it from the tenant.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await resolveOwnerTenantId(user.id)
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  await disconnectAccount(tenantId)
  return NextResponse.json({ ok: true })
}

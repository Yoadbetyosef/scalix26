import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveOwnerTenantId } from '@/lib/calendar/store'
import { getConnectStatus } from '@/lib/stripe/connect'

// GET → { connected, accountId?, email?, chargesEnabled? } for the Connect Stripe UI.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await resolveOwnerTenantId(user.id)
  if (!tenantId) return NextResponse.json({ connected: false })

  return NextResponse.json(await getConnectStatus(tenantId))
}

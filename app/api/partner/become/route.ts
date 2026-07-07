import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPartner } from '@/lib/partner/create'

// The viral loop: an existing signed-in customer (tenant owner) becomes a partner. Reuses their
// auth identity — no new login. Idempotent (createPartner returns the existing org if any).
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  // Provenance: link the partner to the tenant they came from (analytics + trust).
  const { data: tenant } = await supabase.from('tenants').select('id, business_name').eq('user_id', user.id).maybeSingle()

  const res = await createPartner({
    userId: user.id,
    contactEmail: user.email,
    companyName: body.companyName || tenant?.business_name || null,
    partnerType: 'affiliate',
    originTenantId: tenant?.id || null,
  })
  if (res.error) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ success: true, partnerId: res.partnerId, slug: res.slug })
}

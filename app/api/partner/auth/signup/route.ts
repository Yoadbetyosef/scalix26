import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { createPartner } from '@/lib/partner/create'
import type { PartnerType } from '@/lib/partner/rbac'
import { enforce, clientIp } from '@/lib/ratelimit'

// Brand-new partner signup: creates an auth user + a partner org (NO tenant). This is the key
// departure from /api/auth/signup, which always creates a tenant. Public route.
export async function POST(req: NextRequest) {
  const limited = await enforce('auth_signup', `ip:${clientIp(req)}`)
  if (limited) return limited
  const { email, password, companyName, contactPhone, partnerType } = await req.json()
  if (!email || !password) return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data.user) return NextResponse.json({ error: 'Signup failed.' }, { status: 400 })

  const validTypes: PartnerType[] = ['affiliate', 'growth', 'agency', 'enterprise']
  const type: PartnerType = validTypes.includes(partnerType) ? partnerType : 'affiliate'

  const res = await createPartner({
    userId: data.user.id,
    contactEmail: email,
    companyName: companyName || null,
    contactPhone: contactPhone || null,
    partnerType: type,
  })
  if (res.error) {
    // Best-effort cleanup so the email can retry cleanly.
    try { await createAdminClient().auth.admin.deleteUser(data.user.id) } catch {}
    return NextResponse.json({ error: "Couldn't create your partner account — please try again." }, { status: 400 })
  }
  return NextResponse.json({ success: true, partnerId: res.partnerId, slug: res.slug })
}

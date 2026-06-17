import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { insertTenantWithUniqueSlug } from '@/lib/tenants'

export async function POST(req: NextRequest) {
  const { email, password, businessName, industry } = await req.json()

  const supabase = await createClient()
  const serviceSupabase = await createServiceClient()

  // 1. Sign up the user
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data.user) return NextResponse.json({ error: 'Signup failed' }, { status: 400 })

  // 2. Create tenant using service role (bypasses RLS — safe here since we just created
  // the user). The DB trigger assigns a unique slug; the helper retries on a slug
  // collision and never surfaces raw DB errors.
  const { error: tenantError } = await insertTenantWithUniqueSlug(serviceSupabase, {
    user_id: data.user.id,
    business_name: businessName,
    industry,
    email,
    plan: 'trial',
  })

  if (tenantError) return NextResponse.json({ error: "Couldn't create your account — please try again." }, { status: 400 })

  return NextResponse.json({ success: true, user: data.user })
}

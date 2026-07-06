import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { insertTenantWithUniqueSlug } from '@/lib/tenants'
import { DEFAULT_ENABLED_MODULES } from '@/lib/modules'

const FRIENDLY_ERROR = "Couldn't create your account — please try again."

export async function POST(req: NextRequest) {
  const { businessName, industry, userId, email } = await req.json()

  const supabase = await createServiceClient()

  // Check if tenant already exists
  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (existing) {
    // Update existing tenant instead of creating duplicate
    const { error } = await supabase
      .from('tenants')
      .update({ business_name: businessName, industry })
      .eq('id', existing.id)
    if (error) {
      console.error('[create-tenant] update failed:', error.code, error.message)
      return NextResponse.json({ error: FRIENDLY_ERROR }, { status: 400 })
    }
  } else {
    // DB trigger assigns a unique slug; helper retries on slug collision and never
    // surfaces raw DB errors.
    const { error } = await insertTenantWithUniqueSlug(supabase, {
      user_id: userId,
      business_name: businessName,
      industry,
      email,
      plan: 'trial',
      // New businesses start with the core modules on; the rest are opt-in per business.
      enabled_modules: DEFAULT_ENABLED_MODULES,
    })
    if (error) return NextResponse.json({ error: FRIENDLY_ERROR }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}

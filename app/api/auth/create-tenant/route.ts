import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { insertTenantWithUniqueSlug } from '@/lib/tenants'
import { DEFAULT_ENABLED_MODULES } from '@/lib/modules'
import { resolveMembership } from '@/lib/team/members'
import { enforce, clientIp } from '@/lib/ratelimit'

const FRIENDLY_ERROR = "Couldn't create your account — please try again."

// Creates the business behind a brand-new signup. Called from /setup, which always has a session.
//
// ── THE USER ID COMES FROM THE SESSION, NOT THE BODY ───────────────────────────────────────────────
//
// This route used to read `userId` out of the POST body and write a tenant for it, while sitting
// behind the '/api/auth/' prefix in PUBLIC_ROUTES — so it took no session at all. Anyone who could
// reach the URL could mint a business for any user id they cared to name. The session is now the only
// source of identity here and the body's userId is ignored entirely.
//
// ── AND A MEMBER OF SOMEBODY ELSE'S BUSINESS IS NOT A NEW SIGNUP ──────────────────────────────────
//
// A team member has no tenant of her own, which is exactly the shape of a fresh signup. If she ever
// reached this route the tenant it created WOULD BECOME HERS — getActiveWorkspace() checks ownership
// before membership, so a brand-new empty business would silently outrank the one she was hired to
// work in, and she would log in to an empty dashboard with her colleagues nowhere in sight. Nothing
// routes her here today; this makes that a rule rather than a routing coincidence.
export async function POST(req: NextRequest) {
  const limited = await enforce('auth_signup', `ip:${clientIp(req)}`)
  if (limited) return limited

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 })

  const { businessName, industry } = await req.json().catch(() => ({}))
  if (typeof businessName !== 'string' || !businessName.trim()) {
    return NextResponse.json({ error: 'A business name is required.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Already on a team → they are staff somewhere, not a new business. See the note above.
  const membership = await resolveMembership(user.id)
  if (membership) {
    return NextResponse.json(
      { error: 'Your login is already part of a business. Ask its owner if you need another workspace.' },
      { status: 409 },
    )
  }

  const { data: existing } = await admin
    .from('tenants')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (existing) {
    // Update the existing tenant instead of creating a duplicate.
    const { error } = await admin
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
    const { error } = await insertTenantWithUniqueSlug(admin, {
      user_id: user.id,
      business_name: businessName,
      industry,
      email: user.email,
      plan: 'trial',
      // New businesses start with the core modules on; the rest are opt-in per business.
      enabled_modules: DEFAULT_ENABLED_MODULES,
    })
    if (error) return NextResponse.json({ error: FRIENDLY_ERROR }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getInviteByToken } from '@/lib/partner/invites'
import { logPartnerAction } from '@/lib/partner/audit'

// PUBLIC. The invited business owner accepts: they set a password, we create their auth user and LINK
// it to their business (tenants.user_id = the new user) — reusing the single-owner model so the whole
// existing product + RLS just works for them. The 256-bit token is the only secret; the browser never
// supplies a tenant id. After this, the client signs in with the same password (client-side) and lands
// in their own branded business — never the partner console.
export async function POST(req: NextRequest) {
  const { token, password } = await req.json().catch(() => ({}))
  if (!token || typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'A password of at least 8 characters is required.' }, { status: 400 })
  }

  const found = await getInviteByToken(token)
  if (!found) return NextResponse.json({ error: 'This invitation is invalid.' }, { status: 404 })
  const { invite, tenant } = found
  if (invite.status === 'accepted') return NextResponse.json({ error: 'This invitation was already used.' }, { status: 409 })
  if (invite.status === 'revoked') return NextResponse.json({ error: 'This invitation was revoked.' }, { status: 410 })
  if (invite.status === 'expired') return NextResponse.json({ error: 'This invitation has expired.' }, { status: 410 })
  if (!tenant) return NextResponse.json({ error: 'Business not found.' }, { status: 404 })

  const admin = createAdminClient()

  // Guard: never re-link a business that already has an owner.
  const { data: t } = await admin.from('tenants').select('id, user_id').eq('id', invite.tenant_id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Business not found.' }, { status: 404 })
  if (t.user_id) return NextResponse.json({ error: 'This business already has an owner.' }, { status: 409 })

  // Create the auth user (email pre-confirmed — the invite proves email ownership).
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: invite.email, password, email_confirm: true,
    user_metadata: { full_name: [invite.first_name, invite.last_name].filter(Boolean).join(' ') || undefined },
  })
  if (cErr || !created?.user) {
    const already = /registered|already/i.test(cErr?.message || '')
    return NextResponse.json({ error: already ? 'An account already exists for this email — please sign in instead.' : 'Could not create your account.' }, { status: already ? 409 : 400 })
  }
  const userId = created.user.id

  // Link the user to their business (single-owner model → RLS get_tenant_id() resolves for them).
  const now = new Date().toISOString()
  const { error: linkErr } = await admin.from('tenants').update({ user_id: userId, first_login_at: now, last_login_at: now }).eq('id', invite.tenant_id).is('user_id', null)
  if (linkErr) {
    // Roll back the auth user so the invite can be retried cleanly.
    await admin.auth.admin.deleteUser(userId).catch(() => {})
    return NextResponse.json({ error: 'Could not activate your business — please try again.' }, { status: 400 })
  }

  await admin.from('business_invites').update({ status: 'accepted', accepted_at: now, accepted_user_id: userId, updated_at: now }).eq('id', invite.id)
  await logPartnerAction(invite.partner_id, userId, { action: 'invite.accepted', targetType: 'tenant', targetId: invite.tenant_id, after: { email: invite.email } })
  await logPartnerAction(invite.partner_id, userId, { action: 'client.password_created', targetType: 'tenant', targetId: invite.tenant_id })

  // Return the email so the client can establish a session via signInWithPassword (same credentials).
  return NextResponse.json({ ok: true, email: invite.email })
}

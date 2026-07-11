import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getPartnerContext } from '@/lib/partner/rbac'
import { partnerOwnsTenant } from '@/lib/workspace'
import { logPartnerAction } from '@/lib/partner/audit'
import { resolveBrandForPartner, resolveBrandData } from '@/lib/partner/brand'
import { getInviteForTenant, upsertInvite, newInviteToken } from '@/lib/partner/invites'
import { sendInviteEmail } from '@/lib/partner/invite-email'
import { requestBaseUrl } from '@/lib/request-url'

// Manage the owner invitation for one client business. Every request re-validates that THIS partner
// owns the tenant (server-side) — a browser-supplied tenant_id is never trusted. All actions audited.
export async function GET(req: NextRequest) {
  const ctx = await getPartnerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = req.nextUrl.searchParams.get('tenant_id') || ''
  if (!(await partnerOwnsTenant(ctx.partnerId, tenantId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ invite: await getInviteForTenant(tenantId) })
}

export async function POST(req: NextRequest) {
  const ctx = await getPartnerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const tenantId = b.tenant_id as string
  const action = b.action as string
  if (!tenantId || !(await partnerOwnsTenant(ctx.partnerId, tenantId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createAdminClient()
  const audit = (a: string, after?: unknown) => logPartnerAction(ctx.partnerId, ctx.userId, { action: a, targetType: 'tenant', targetId: tenantId, after })

  // Revoke: kill the current invite (its token stops working).
  if (action === 'revoke') {
    await db.from('business_invites').update({ status: 'revoked', updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).neq('status', 'accepted')
    await audit('invite.revoked')
    return NextResponse.json({ invite: await getInviteForTenant(tenantId) })
  }

  // Create / save / send / resend / copy_link all need the recipient details.
  const email = (b.email || '').trim()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'A valid owner email is required' }, { status: 400 })
  let invite = await upsertInvite({
    tenantId, partnerId: ctx.partnerId, email,
    firstName: b.first_name, lastName: b.last_name, phone: b.phone, role: b.role,
  })
  if (invite.status === 'accepted') return NextResponse.json({ error: 'This owner has already accepted.' }, { status: 409 })
  await audit('invite.created', { email })

  // A fresh, unexpired token for the link (regenerate on every send/resend/copy so old links die).
  const token = newInviteToken()
  await db.from('business_invites').update({ token, expires_at: new Date(Date.now() + 14 * 864e5).toISOString() }).eq('id', invite.id)
  const acceptUrl = `${requestBaseUrl(req)}/invite/${token}`

  if (action === 'copy_link') {
    await db.from('business_invites').update({ status: invite.status === 'draft' ? 'sent' : invite.status, invited_at: new Date().toISOString() }).eq('id', invite.id)
    await audit('invite.link_copied')
    return NextResponse.json({ invite: await getInviteForTenant(tenantId), link: acceptUrl })
  }

  if (action === 'send' || action === 'resend') {
    const brand = (await resolveBrandForPartner(ctx.partnerId)) || (await resolveBrandData(req.headers.get('host')))
    const { data: t } = await db.from('tenants').select('business_name').eq('id', tenantId).maybeSingle()
    const res = await sendInviteEmail({ brand, to: email, businessName: t?.business_name || 'your business', firstName: invite.first_name, acceptUrl })
    await db.from('business_invites').update({ status: 'sent', invited_at: new Date().toISOString(), invited_by: ctx.userId }).eq('id', invite.id)
    await audit(action === 'resend' ? 'invite.resent' : 'invite.sent', { email, emailed: res.success })
    return NextResponse.json({ invite: await getInviteForTenant(tenantId), emailed: res.success, ...(res.success ? {} : { note: 'Saved, but email delivery is unavailable — use Copy Link.' }) })
  }

  // action === 'save' (or unknown) → just persisted the details as a draft.
  return NextResponse.json({ invite: await getInviteForTenant(tenantId) })
}

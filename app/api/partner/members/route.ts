import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canManageTeam, type PartnerRole } from '@/lib/partner/rbac'
import { logPartnerAction } from '@/lib/partner/audit'
import { sendEmail, emailTemplates } from '@/lib/email/send'

const PARTNER_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.scalix26.com'

const ROLES: PartnerRole[] = ['owner', 'manager', 'sales', 'marketing', 'finance', 'support']

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const { data: members } = await db.from('partner_members')
    .select('id, user_id, role, status, invited_email, created_at')
    .eq('partner_id', ctx.partnerId).order('created_at', { ascending: true })

  // Resolve emails for member users (auth is not RLS-readable).
  const ids = (members || []).map((m) => m.user_id).filter(Boolean) as string[]
  const emails: Record<string, string> = {}
  if (ids.length) {
    const { data: authList } = await db.auth.admin.listUsers({ perPage: 1000 })
    for (const u of authList?.users || []) if (ids.includes(u.id)) emails[u.id] = u.email || ''
  }
  return NextResponse.json({ members: (members || []).map((m) => ({ ...m, email: m.user_id ? emails[m.user_id] : m.invited_email })) })
}

export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageTeam(ctx)) return NextResponse.json({ error: 'Only agency owners/managers can invite team members.' }, { status: 403 })
  const { email, role } = await req.json()
  if (!email) return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  const r: PartnerRole = ROLES.includes(role) ? role : 'sales'
  const db = createAdminClient()
  const { error } = await db.from('partner_members').insert({
    partner_id: ctx.partnerId, invited_email: String(email).toLowerCase(), role: r, status: 'invited',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'member.invited', targetType: 'member', after: { email, role: r } })
  // The member row is created either way; the invitation email is what may not arrive. Report which,
  // so nobody waits for a message that was never delivered.
  let invited = false
  try {
    const tmpl = emailTemplates.partnerInvite(ctx.companyName || 'a Scalix26 partner', r, `${PARTNER_APP_URL}/partner/login`)
    invited = (await sendEmail(String(email), tmpl.subject, tmpl.html)).success
  } catch { /* the member is still invited in the table */ }
  return NextResponse.json({ success: true, invitationEmailed: invited })
}

export async function PATCH(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageTeam(ctx)) return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 })
  const { memberId, role, status } = await req.json()
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (role && ROLES.includes(role)) patch.role = role
  if (status && ['active', 'disabled'].includes(status)) patch.status = status
  const db = createAdminClient()
  const { error } = await db.from('partner_members').update(patch).eq('id', memberId).eq('partner_id', ctx.partnerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'member.updated', targetType: 'member', targetId: memberId, after: patch })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageTeam(ctx)) return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 })
  const memberId = new URL(req.url).searchParams.get('id')
  if (!memberId) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = createAdminClient()
  // Never remove the last owner.
  const { data: target } = await db.from('partner_members').select('role, user_id').eq('id', memberId).eq('partner_id', ctx.partnerId).maybeSingle()
  if (target?.role === 'owner') {
    const { count } = await db.from('partner_members').select('id', { count: 'exact', head: true }).eq('partner_id', ctx.partnerId).eq('role', 'owner').eq('status', 'active')
    if ((count ?? 0) <= 1) return NextResponse.json({ error: 'Cannot remove the last owner.' }, { status: 400 })
  }
  const { error } = await db.from('partner_members').delete().eq('id', memberId).eq('partner_id', ctx.partnerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'member.removed', targetType: 'member', targetId: memberId })
  return NextResponse.json({ success: true })
}

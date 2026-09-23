import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { listMembers, inviteMember, type InviteError } from '@/lib/team/members'
import { ASSIGNABLE_ROLES, type TeamRole } from '@/lib/team/roles'
import { enforce } from '@/lib/ratelimit'
import { requestBaseUrl } from '@/lib/request-url'

// THE TEAM OF THE ACTIVE BUSINESS.
//
// Gated on requireActiveBusinessContext — the single server-side answer to "which business, and as
// whom" — and then on capabilities.canManageTeam, which only an owner has. Every query downstream is
// scoped by the tenantId that context resolved; nothing here reads a tenant id from the browser.
//
// 404 rather than 403 for a caller without the capability, matching the module guards: a staff member
// poking at this route learns nothing about whether it exists.

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().max(320),
  fullName: z.string().trim().max(120).nullable().optional(),
  role: z.enum(ASSIGNABLE_ROLES as [TeamRole, ...TeamRole[]]),
})

const MESSAGES: Record<InviteError, string> = {
  invalid_email: 'That does not look like an email address.',
  invalid_role: 'Pick a role for this person.',
  already_member: 'That person is the owner of this business.',
  active_elsewhere: 'That email is already active on another Scalix business. A person can belong to one business at a time.',
  auth_failed: 'Could not create the login. Please try again.',
  db_failed: 'Could not save the team member. Please try again.',
  unavailable: 'Team accounts are not enabled yet — the tenant_members migration has not been run.',
}

export async function GET() {
  const ctx = await requireActiveBusinessContext()
  if (!ctx || !ctx.capabilities.canManageTeam) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { members, unavailable } = await listMembers(ctx.tenantId)
  return NextResponse.json({ members, unavailable, assignableRoles: ASSIGNABLE_ROLES })
}

export async function POST(req: NextRequest) {
  const ctx = await requireActiveBusinessContext()
  if (!ctx || !ctx.capabilities.canManageTeam) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Each invite mints a Supabase link and sends mail — cap it so the screen can't be used to
  // email-bomb. Keyed by tenant: one business's owner cannot spend another's budget.
  const flood = await enforce('invite_email', `team:${ctx.tenantId}`)
  if (flood) return flood

  const parsed = inviteSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })

  const { data: tenant } = await createAdminClient()
    .from('tenants').select('business_name').eq('id', ctx.tenantId).maybeSingle()

  const result = await inviteMember({
    tenantId: ctx.tenantId,
    businessName: tenant?.business_name || 'your business',
    email: parsed.data.email,
    fullName: parsed.data.fullName ?? null,
    role: parsed.data.role,
    invitedBy: ctx.actorUserId,
    appUrl: requestBaseUrl(req) || process.env.NEXT_PUBLIC_APP_URL || '',
  })

  if (!result.ok) {
    const status = result.error === 'unavailable' ? 503 : result.error === 'active_elsewhere' ? 409 : 400
    return NextResponse.json({ error: MESSAGES[result.error ?? 'db_failed'] }, { status })
  }

  // `emailed: false` is reported honestly rather than swallowed — the seat exists either way, and the
  // owner needs to know whether to hit Resend.
  return NextResponse.json({ ok: true, member: result.member, emailed: result.emailed })
}

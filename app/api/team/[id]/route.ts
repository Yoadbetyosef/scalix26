import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { getMember, setMemberRole, deactivateMember } from '@/lib/team/members'
import { ASSIGNABLE_ROLES, canManageMember, type TeamRole } from '@/lib/team/roles'

// One team member. Both verbs run the same three checks in the same order:
//
//   1. requireActiveBusinessContext  — which business, and as whom
//   2. getMember(tenantId, id)       — the row must belong to THAT business (an id from another
//                                      tenant returns null, so this is the IDOR gate)
//   3. canManageMember               — may this actor act on this target (never an owner, never self)
//
// The third check is in lib/team/roles.ts rather than inline, because "may I edit this person" is a
// policy question and the answer must be the same here as it is on the screen that renders the button.

const patchSchema = z.object({ role: z.enum(ASSIGNABLE_ROLES as [TeamRole, ...TeamRole[]]) })

async function resolve(id: string) {
  const ctx = await requireActiveBusinessContext()
  if (!ctx || !ctx.capabilities.canManageTeam) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const target = await getMember(ctx.tenantId, id)
  if (!target) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (!canManageMember({ role: ctx.role, userId: ctx.actorUserId }, { role: target.role, userId: target.userId })) {
    return { error: NextResponse.json({ error: 'That team member cannot be changed here.' }, { status: 403 }) }
  }
  return { ctx, target }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await resolve(id)
  if (r.error) return r.error

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  const ok = await setMemberRole(r.ctx!.tenantId, id, parsed.data.role)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Could not update that team member.' }, { status: 400 })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await resolve(id)
  if (r.error) return r.error

  const ok = await deactivateMember(r.ctx!.tenantId, id)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Could not remove that team member.' }, { status: 400 })
}

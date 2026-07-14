import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { saveTeamRole, deleteTeamRole } from '@/lib/command-center/team-store'
import { DEPARTMENTS, DRIVERS } from '@/lib/command-center/capacity-v2'

// Founder-only team-roster writes. Self-guarded (404 before ANY work), zod-validated, audited by the store.
const patchSchema = z.object({
  id: z.string().uuid().nullable().optional(), // null/absent = create
  department: z.enum(DEPARTMENTS).optional(),
  role: z.string().max(120).optional(),
  currentHeadcount: z.number().int().min(0).max(100000).optional(),
  plannedHeadcount: z.number().int().min(0).max(100000).optional(),
  monthlySalaryCents: z.number().int().min(0).optional(),
  commissionCents: z.number().int().min(0).optional(),
  payrollBurdenPct: z.number().min(0).max(5).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  capacityDriver: z.enum(DRIVERS).optional(),
  capacityPerEmployee: z.number().min(0).optional(),
  targetUtilization: z.number().min(0).max(1).optional(),
  notes: z.string().max(1000).nullable().optional(),
})

export async function PATCH(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const { id, ...patch } = parsed.data
  if (!id && (!patch.department || !patch.role)) return NextResponse.json({ error: 'department and role are required to create a role' }, { status: 400 })
  const after = await saveTeamRole(id ?? null, patch, f.email)
  return NextResponse.json({ ok: true, role: after })
}

export async function DELETE(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const b = await req.json().catch(() => ({}))
  if (!b.id || typeof b.id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 })
  await deleteTeamRole(b.id, f.email)
  return NextResponse.json({ ok: true })
}

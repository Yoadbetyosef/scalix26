import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { saveTeamRealityRole, closeTeamRealityRole } from '@/lib/command-center/team-reality-store'
import { DEPARTMENTS } from '@/lib/command-center/capacity-v2'

// Founder-only Team Reality writes. Edits VERSION the role (close prior period + new active row); DELETE
// soft-closes. Self-guarded (404 first), zod-validated, audited by the store.
const patchSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  department: z.enum(DEPARTMENTS).optional(),
  role: z.string().max(120).optional(),
  currentHeadcount: z.number().int().min(0).max(100000).optional(),
  monthlySalaryCents: z.number().int().min(0).optional(),
  commissionCents: z.number().int().min(0).optional(),
  payrollBurdenPct: z.number().min(0).max(5).optional(),
  capacityModelId: z.string().uuid().nullable().optional(),
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
  const after = await saveTeamRealityRole(id ?? null, patch, f.email)
  return NextResponse.json({ ok: true, role: after })
}

export async function DELETE(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const b = await req.json().catch(() => ({}))
  if (!b.id || typeof b.id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 })
  await closeTeamRealityRole(b.id, f.email)
  return NextResponse.json({ ok: true })
}

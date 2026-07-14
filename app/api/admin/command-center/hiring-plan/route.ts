import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { saveHiringPlan, deleteHiringPlan, moveHireToReality } from '@/lib/command-center/hiring-plan-store'
import { DEPARTMENTS, HIRING_STATUSES } from '@/lib/command-center/capacity-v2'

// Founder-only Hiring Plan writes. PATCH = create/update, DELETE = remove, POST {action:'move_to_reality'} =
// atomic promote to Team Reality (never automatic). Self-guarded (404 first), zod-validated, audited.
const patchSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  department: z.enum(DEPARTMENTS).optional(),
  role: z.string().max(120).optional(),
  headcount: z.number().int().min(1).max(100000).optional(),
  plannedStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  monthlySalaryCents: z.number().int().min(0).optional(),
  commissionCents: z.number().int().min(0).optional(),
  payrollBurdenPct: z.number().min(0).max(5).optional(),
  capacityModelId: z.string().uuid().nullable().optional(),
  hiringReason: z.string().max(1000).nullable().optional(),
  growthEngine: z.enum(['direct', 'affiliate', 'whiteLabel', 'expansion']).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
  status: z.enum(HIRING_STATUSES).optional(),
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
  if (!id && (!patch.department || !patch.role)) return NextResponse.json({ error: 'department and role are required to create a planned hire' }, { status: 400 })
  const after = await saveHiringPlan(id ?? null, patch, f.email)
  return NextResponse.json({ ok: true, plan: after })
}

export async function POST(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const b = await req.json().catch(() => ({}))
  if (b.action !== 'move_to_reality' || !b.id || typeof b.id !== 'string') return NextResponse.json({ error: 'action=move_to_reality and id required' }, { status: 400 })
  try {
    const realityId = await moveHireToReality(b.id, f.email)
    return NextResponse.json({ ok: true, realityId })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }) }
}

export async function DELETE(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const b = await req.json().catch(() => ({}))
  if (!b.id || typeof b.id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 })
  await deleteHiringPlan(b.id, f.email)
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { saveCapacityModel } from '@/lib/command-center/capacity-model-store'
import { DRIVERS, PERIODS } from '@/lib/command-center/capacity-v2'

// Founder-only Capacity Model (config) writes. Edits VERSION the model (close prior active + new active row)
// so assumptions are never silently overwritten. Self-guarded (404 first), zod-validated, audited.
const patchSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  roleKey: z.string().max(80).optional(),
  label: z.string().max(120).optional(),
  capacityDriver: z.enum(DRIVERS).optional(),
  capacityPerEmployee: z.number().min(0).optional(),
  capacityUnit: z.string().max(80).optional(),
  capacityPeriod: z.enum(PERIODS).optional(),
  demandMetricKey: z.string().max(120).nullable().optional(),
  targetUtilization: z.number().gt(0).max(1).optional(),
  sourceClassification: z.string().max(40).optional(),
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
  if (!id && (!patch.roleKey || !patch.capacityDriver)) return NextResponse.json({ error: 'roleKey and capacityDriver are required to create a model' }, { status: 400 })
  const after = await saveCapacityModel(id ?? null, patch, f.email)
  return NextResponse.json({ ok: true, model: after })
}

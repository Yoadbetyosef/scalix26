import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { saveMilestone, saveMissionTarget } from '@/lib/command-center/mission-store'

// Founder-only Mission writes: edit a milestone (target value/date/label) or a headline mission target.
// Self-guarded (404 first), zod-validated, audited by the store.
const schema = z.object({
  milestoneId: z.string().uuid().optional(),
  label: z.string().max(120).optional(),
  targetValue: z.number().optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sortOrder: z.number().int().optional(),
  targetMetricKey: z.string().max(80).optional(),
})

export async function PATCH(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const p = parsed.data
  if (p.milestoneId) {
    await saveMilestone(p.milestoneId, { label: p.label, targetValue: p.targetValue, targetDate: p.targetDate, sortOrder: p.sortOrder }, f.email)
    return NextResponse.json({ ok: true })
  }
  if (p.targetMetricKey && typeof p.targetValue === 'number') {
    await saveMissionTarget(p.targetMetricKey, p.targetValue, f.email)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'milestoneId or (targetMetricKey + targetValue) required' }, { status: 400 })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { savePlan } from '@/lib/command-center/plan-store'

// Founder-only Plan writes — the founder sets ONLY the destination + engine allocation; the cascade is derived.
// Self-guarded (404 first), zod-validated, audited.
const schema = z.object({
  primaryMetric: z.enum(['arr_cents', 'mrr_cents', 'paying_customers', 'revenue', 'profit']).optional(),
  annualTarget: z.number().min(0).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  arpuTargetCents: z.number().int().min(0).nullable().optional(),
  monthlyGoalOverride: z.number().min(0).nullable().optional(),
  allocation: z.object({ direct: z.number().min(0), affiliate: z.number().min(0), whiteLabel: z.number().min(0), expansion: z.number().min(0) }).optional(),
  mode: z.enum(['simple', 'advanced']).optional(),
  status: z.enum(['draft', 'active']).optional(),
})

export async function PATCH(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const plan = await savePlan(parsed.data, f.email)
  return NextResponse.json({ ok: true, plan })
}

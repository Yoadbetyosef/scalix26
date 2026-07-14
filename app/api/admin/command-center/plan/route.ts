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
  const p = { ...parsed.data }

  // Target date must be on/after the start date.
  if (p.startDate && p.targetDate && p.targetDate < p.startDate) return NextResponse.json({ error: 'Target date must be on or after the start date' }, { status: 400 })

  // Allocation is entered as PERCENTAGES that must total 100%; we store normalized fractions summing to 1
  // (matches the DB constraint). We never silently accept a total that isn't 100%.
  if (p.allocation) {
    const sum = p.allocation.direct + p.allocation.affiliate + p.allocation.whiteLabel + p.allocation.expansion
    if (sum <= 0) return NextResponse.json({ error: 'Allocation is required' }, { status: 400 })
    if (Math.abs(sum - 100) > 0.5) return NextResponse.json({ error: `Allocation must total 100% (got ${sum.toFixed(1)}%)` }, { status: 400 })
    p.allocation = { direct: p.allocation.direct / sum, affiliate: p.allocation.affiliate / sum, whiteLabel: p.allocation.whiteLabel / sum, expansion: p.allocation.expansion / sum }
  }
  const plan = await savePlan(p, f.email)
  return NextResponse.json({ ok: true, plan })
}

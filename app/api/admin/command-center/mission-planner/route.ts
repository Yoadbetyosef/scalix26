import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { loadActiveAssumptions } from '@/lib/command-center/active'
import { simulate, type Decision } from '@/lib/command-center/mission'

// Founder-only Mission Planner simulation. Read-only what-if: applies decisions to the base assumptions and
// returns before/after deltas. Never mutates the Hiring Plan or persisted assumptions. Self-guarded (404 first).
const decisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('increasePricingPct'), pct: z.number().min(-1).max(5) }), // fraction: -100%..+500%
  z.object({ kind: z.literal('setBlendedPriceCents'), cents: z.number().int().min(0) }),
  z.object({ kind: z.literal('hireSalesReps'), count: z.number().int().min(0).max(1000), salaryPerMonthCents: z.number().int().min(0) }),
  z.object({ kind: z.literal('setAffiliateActivation'), rate: z.number().min(0).max(1) }),
  z.object({ kind: z.literal('setMonthlyChurn'), rate: z.number().min(0).max(1) }),
  z.object({ kind: z.literal('addMarketingBudgetCents'), cents: z.number().int().min(0) }),
])
const schema = z.object({ decisions: z.array(decisionSchema).max(20), horizonMonth: z.number().int().min(1).max(120).optional() })

export async function POST(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const { assumptions } = await loadActiveAssumptions(f.email)
  const sim = simulate(assumptions, parsed.data.decisions as Decision[], 60, parsed.data.horizonMonth ?? 60)
  return NextResponse.json({ ok: true, delta: sim.delta })
}

import { NextRequest, NextResponse } from 'next/server'
import { authAgent, isAuthError } from '@/lib/playbook/data'
import { runBrain } from '@/lib/brain/engine'
import { snapshotBrain, recordBrainUpdates } from '@/lib/brain/updates'
import { enforce } from '@/lib/ratelimit'
import { assertPartnerActive, BILLING_PAUSED_CODE, PAUSED_API_MESSAGE } from '@/lib/billing/gate'

export const maxDuration = 60

// Run Phase 1 Business Brain analysis for one AI employee. Deterministic; no LLM, no cron.
// Snapshots before/after to record "What changed today" — the engine itself is untouched.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const limited = await enforce('brain_run', `tenant:${ctx.tenantId}`)
  if (limited) return limited
  // WL prepaid billing gate — the Brain engine is deterministic (no LLM cost), but a paused/depleted
  // partner is blocked here for consistency with the other billable dashboard actions. Inert for direct
  // Scalix tenants and while WL_BILLING_ENABLED is off.
  if (!(await assertPartnerActive({ tenantId: ctx.tenantId })).ok) {
    return NextResponse.json({ error: BILLING_PAUSED_CODE, message: PAUSED_API_MESSAGE }, { status: 402 })
  }
  try {
    const before = await snapshotBrain(ctx.admin, ctx.tenantId, agentId)
    const result = await runBrain(ctx.admin, ctx.tenantId, agentId)
    const after = await snapshotBrain(ctx.admin, ctx.tenantId, agentId)
    const changes = await recordBrainUpdates(ctx.admin, ctx.tenantId, agentId, before, after)
    return NextResponse.json({ ok: true, result, changes })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Brain run failed' }, { status: 500 })
  }
}

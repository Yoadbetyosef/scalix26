import { NextRequest, NextResponse } from 'next/server'
import { authAgent, isAuthError } from '@/lib/playbook/data'
import { runBrain } from '@/lib/brain/engine'

export const maxDuration = 60

// Run Phase 1 Business Brain analysis for one AI employee. Deterministic; no LLM, no cron.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  try {
    const result = await runBrain(ctx.admin, ctx.tenantId, agentId)
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Brain run failed' }, { status: 500 })
  }
}

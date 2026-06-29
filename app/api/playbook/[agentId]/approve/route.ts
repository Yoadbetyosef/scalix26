import { NextRequest, NextResponse } from 'next/server'
import { authAgent, isAuthError } from '@/lib/playbook/data'
import { approvePlaybook } from '@/lib/playbook/apply'
import { normalizePlaybook, type OwnerPlaybook } from '@/lib/playbook/types'

// POST — approve & go live: compile the playbook into system_prompt (the managed block
// every customer channel reads). Optionally accepts the latest edited playbook in the body.
export async function POST(req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  if (!('playbook_status' in ctx.agent)) {
    return NextResponse.json({ error: 'Run the add_owner_playbook.sql migration first.' }, { status: 409 })
  }

  const body = (await req.json().catch(() => ({}))) as { playbook?: OwnerPlaybook }
  const playbook = body.playbook ? normalizePlaybook(body.playbook) : undefined
  if (!playbook && !ctx.agent.playbook) {
    return NextResponse.json({ error: 'No playbook to approve. Generate one first.' }, { status: 400 })
  }

  try {
    const { compiled } = await approvePlaybook(ctx, playbook)
    return NextResponse.json({ status: 'approved', compiled })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Approve failed' }, { status: 500 })
  }
}

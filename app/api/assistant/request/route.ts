import { NextRequest, NextResponse } from 'next/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { precheckAction, createPendingAction } from '@/lib/assistant/execute'
import { ACTIONS, isActionType } from '@/lib/assistant/registry'

// POST /api/assistant/request — the voice assistant (via the browser) asks to perform an
// action. Prechecks feasibility and, if possible, DRAFTS it (pending) — never executes here.
// Body: { action_type, target?, body? }.
export async function POST(req: NextRequest) {
  // Shared context, not tenants.user_id — see the note in /api/assistant/actions.
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return NextResponse.json({ status: 'blocked', reason: 'Not signed in.' }, { status: 401 })
  const tenant = { id: ctx.tenantId }

  let body: { action_type?: string; target?: string; body?: string }
  try { body = await req.json() } catch { return NextResponse.json({ status: 'blocked', reason: 'Bad request.' }, { status: 400 }) }

  const type = String(body.action_type || '')
  if (!isActionType(type)) {
    return NextResponse.json({ status: 'unsupported', reason: 'I can’t do that action yet. I can help draft it, but I can’t send it until it’s connected.' })
  }
  const pre = await precheckAction(tenant.id, type)
  if (!pre.ok) return NextResponse.json({ status: 'blocked', reason: pre.reason })

  // actorUserId, so a drafted action records WHO asked for it — the team member herself, not the
  // owner whose business it is.
  const { id } = await createPendingAction({ tenantId: tenant.id, userId: ctx.actorUserId, type, target: body.target || null, body: body.body || '' })
  return NextResponse.json({ status: 'drafted', id, label: ACTIONS[type].label, body: body.body || '' })
}

import { NextRequest, NextResponse } from 'next/server'
import { authAgent, isAuthError } from '@/lib/playbook/data'
import { generatePlaybook } from '@/lib/playbook/generate'
import { saveDraftPlaybook } from '@/lib/playbook/apply'
import { normalizePlaybook, type OwnerPlaybook } from '@/lib/playbook/types'

// GET — current playbook + status for the AI Training page.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  // If the migration hasn't run yet, playbook_status won't be a column on the row.
  const migrated = 'playbook_status' in ctx.agent
  return NextResponse.json({
    migrated,
    status: ctx.agent.playbook_status || 'none',
    playbook: ctx.agent.playbook ? normalizePlaybook(ctx.agent.playbook) : null,
    onboarding_answers: ctx.agent.onboarding_answers || {},
    updatedAt: ctx.agent.playbook_updated_at || null,
    agentName: ctx.agent.name || 'Amy',
  })
}

// POST — (re)generate a draft playbook from website scan + onboarding + profile.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  if (!('playbook_status' in ctx.agent)) {
    return NextResponse.json({ error: 'Run the add_owner_playbook.sql migration first.' }, { status: 409 })
  }
  try {
    const playbook = await generatePlaybook({ ctx })
    await saveDraftPlaybook(ctx, playbook)
    return NextResponse.json({ status: 'draft', playbook })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Generation failed' }, { status: 500 })
  }
}

// PATCH — save owner edits (draft) and/or onboarding interview answers.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const body = (await req.json().catch(() => ({}))) as {
    playbook?: OwnerPlaybook
    onboarding_answers?: Record<string, string>
  }

  if (body.onboarding_answers) {
    const { error } = await ctx.admin
      .from('ai_employees')
      .update({ onboarding_answers: body.onboarding_answers })
      .eq('id', ctx.agent.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (body.playbook) {
    try {
      await saveDraftPlaybook(ctx, normalizePlaybook(body.playbook))
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Save failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

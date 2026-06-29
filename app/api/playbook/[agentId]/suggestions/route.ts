import { NextRequest, NextResponse } from 'next/server'
import { authAgent, isAuthError } from '@/lib/playbook/data'
import { scanForSuggestions, approveSuggestion, rejectSuggestion } from '@/lib/playbook/suggestions'

// GET — list pending learning suggestions for the review queue.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const { data, error } = await ctx.admin
    .from('playbook_suggestions')
    .select('id, section, observation, proposed, channels, confidence, status, created_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50)
  // Table may not exist yet (migration not run) — treat as empty rather than erroring.
  if (error) return NextResponse.json({ suggestions: [], migrated: false })
  return NextResponse.json({ suggestions: data || [], migrated: true })
}

// POST — scan recent conversations for new suggestions (does not change live behavior).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  try {
    const { added } = await scanForSuggestions(ctx)
    return NextResponse.json({ added })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Scan failed' }, { status: 500 })
  }
}

// PATCH — approve (merge into playbook) or reject a suggestion.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const ctx = await authAgent(agentId)
  if (isAuthError(ctx)) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const body = (await req.json().catch(() => ({}))) as { id?: string; action?: 'approve' | 'reject' }
  if (!body.id || !body.action) return NextResponse.json({ error: 'id and action required' }, { status: 400 })

  try {
    if (body.action === 'approve') await approveSuggestion(ctx, body.id)
    else await rejectSuggestion(ctx, body.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Action failed' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { knowledgeOwnerForWrite } from '@/lib/knowledge/scope'

// Knowledge-base entries for one agent, in the ACTIVE business. Operator-safe: tenant comes ONLY from
// the validated active-workspace context, and the agent must belong to it. Replaces the old browser-side
// supabase.from('knowledge_base') writes (which resolved to the operator's own tenant under RLS).
async function authAgentActive(agentId: string) {
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return { error: 'Forbidden' as const, status: 403 as const }
  const admin = createAdminClient()
  const { data: agent } = await admin.from('ai_employees').select('id, tenant_id').eq('id', agentId).maybeSingle()
  if (!agent || agent.tenant_id !== ctx.tenantId) return { error: 'Not found' as const, status: 404 as const }
  return { admin, tenantId: ctx.tenantId }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params
  const a = await authAgentActive(agentId)
  if ('error' in a) return NextResponse.json({ error: a.error }, { status: a.status })
  const { title, content, shared } = await req.json().catch(() => ({}))
  if (!title?.trim() || !content?.trim()) return NextResponse.json({ error: 'Title and content are required' }, { status: 400 })
  // Tenant-owned knowledge: default to shared (tenant-wide); agent-specific only on explicit opt-out.
  const ownerAgent = knowledgeOwnerForWrite(shared !== false, agentId)
  const { data, error } = await a.admin.from('knowledge_base')
    .insert({ tenant_id: a.tenantId, ai_employee_id: ownerAgent, origin_ai_employee_id: agentId, title: title.trim(), content: content.trim(), source: 'manual' })
    .select('id, title, content, ai_employee_id').single()
  if (error || !data) return NextResponse.json({ error: 'Failed to save' }, { status: 400 })
  return NextResponse.json({ entry: { id: data.id, title: data.title, content: data.content, shared: data.ai_employee_id === null } })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params
  const a = await authAgentActive(agentId)
  if ('error' in a) return NextResponse.json({ error: a.error }, { status: a.status })
  const { entryId, title, content, shared } = await req.json().catch(() => ({}))
  if (!entryId || !title?.trim() || !content?.trim()) return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  const patch: Record<string, unknown> = { title: title.trim(), content: content.trim() }
  // Optional visibility change (shared <-> only this agent). Tenant is the ownership boundary,
  // so we scope by (id, tenant_id) — not ai_employee_id (the entry may be shared or agent-specific).
  if (typeof shared === 'boolean') patch.ai_employee_id = knowledgeOwnerForWrite(shared, agentId)
  const { error } = await a.admin.from('knowledge_base')
    .update(patch)
    .eq('id', entryId).eq('tenant_id', a.tenantId)
  if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params
  const a = await authAgentActive(agentId)
  if ('error' in a) return NextResponse.json({ error: a.error }, { status: a.status })
  const entryId = req.nextUrl.searchParams.get('entryId')
  if (!entryId) return NextResponse.json({ error: 'entryId required' }, { status: 400 })
  const { error } = await a.admin.from('knowledge_base').delete()
    .eq('id', entryId).eq('tenant_id', a.tenantId)
  if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 400 })
  return NextResponse.json({ ok: true })
}

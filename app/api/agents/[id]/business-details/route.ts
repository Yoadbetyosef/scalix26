import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'

// The 3 fixed business-detail fields (Pricing / Service Areas / What We Don't Do) are stored as
// knowledge_base rows with source='template'. Bulk-replace them for the ACTIVE business. Operator-safe:
// tenant comes ONLY from the validated active-workspace context, and the agent must belong to it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: agent } = await admin.from('ai_employees').select('id, tenant_id').eq('id', agentId).maybeSingle()
  if (!agent || agent.tenant_id !== ctx.tenantId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { details } = await req.json().catch(() => ({}))
  if (!details || typeof details !== 'object') return NextResponse.json({ error: 'details required' }, { status: 400 })

  // Pricing / Service Areas / What We Don't Do belong to the BUSINESS the agent is — which on a
  // multi-business tenant (see scan-website) is the agent, not the tenant. Stored scoped to the
  // agent; prior rows for the same field are replaced whether they were written shared or scoped,
  // as long as this agent wrote them (or nobody knows who did), so another agent's Pricing is never
  // overwritten by this one's.
  for (const [title, raw] of Object.entries(details as Record<string, string>)) {
    await admin.from('knowledge_base').delete()
      .eq('tenant_id', ctx.tenantId).eq('source', 'template').eq('title', title)
      .or(`origin_ai_employee_id.eq.${agentId},origin_ai_employee_id.is.null`)
    const content = (raw || '').trim()
    if (content) {
      const { error } = await admin.from('knowledge_base')
        .insert({ tenant_id: ctx.tenantId, ai_employee_id: agentId, origin_ai_employee_id: agentId, title, content, source: 'template' })
      if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 400 })
    }
  }
  return NextResponse.json({ ok: true })
}

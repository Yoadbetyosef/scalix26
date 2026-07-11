import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { isKnownSkill, skillName } from '@/lib/skills'

// Toggle a skill on/off for an agent. Upserts the `skills` row (the same shape the
// old wizard wrote) so the AI pipeline picks it up. { type, active }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type, active } = await req.json().catch(() => ({}))
  if (!type || !isKnownSkill(type)) return NextResponse.json({ error: 'Unknown skill' }, { status: 400 })

  // Admin client (operator-safe): createServiceClient would RLS-scope to the operator's own tenant.
  // Ownership is validated below against the active workspace before any write.
  const service = createAdminClient()
  const { data: agent } = await service.from('ai_employees').select('id, tenant_id').eq('id', agentId).single()
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  const activeTenantId = await getActiveTenantId()
  if (!activeTenantId || agent.tenant_id !== activeTenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: existing } = await service.from('skills')
    .select('id').eq('ai_employee_id', agentId).eq('type', type).maybeSingle()
  if (existing) {
    await service.from('skills').update({ active: !!active }).eq('id', existing.id)
  } else {
    await service.from('skills').insert({ tenant_id: agent.tenant_id, ai_employee_id: agentId, name: skillName(type), type, active: !!active })
  }
  return NextResponse.json({ success: true })
}

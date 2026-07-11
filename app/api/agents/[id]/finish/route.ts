import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'

// Mark an agent's first-run setup as finished (clears the draft flag, so it's no
// longer reused by "New Employee"). Best-effort + tolerant of an unmigrated column.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Admin client (operator-safe): createServiceClient downgrades to the operator's JWT under RLS, so the
  // agent read + update would scope to the partner's own tenant. Ownership is validated below.
  const service = createAdminClient()
  const { data: agent } = await service.from('ai_employees').select('id, tenant_id').eq('id', agentId).single()
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  const activeTenantId = await getActiveTenantId()
  if (!activeTenantId || agent.tenant_id !== activeTenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await service.from('ai_employees').update({ setup_complete: true }).eq('id', agentId)
  if (error) console.warn('[agents/finish] could not mark complete (run add_agent_setup_complete.sql?):', error.message)
  return NextResponse.json({ success: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Mark an agent's first-run setup as finished (clears the draft flag, so it's no
// longer reused by "New Employee"). Best-effort + tolerant of an unmigrated column.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { data: agent } = await service.from('ai_employees').select('id, tenant_id').eq('id', agentId).single()
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  const { data: tenant } = await service.from('tenants').select('id').eq('id', agent.tenant_id).eq('user_id', user.id).single()
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await service.from('ai_employees').update({ setup_complete: true }).eq('id', agentId)
  if (error) console.warn('[agents/finish] could not mark complete (run add_agent_setup_complete.sql?):', error.message)
  return NextResponse.json({ success: true })
}

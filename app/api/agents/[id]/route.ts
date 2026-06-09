import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: agentId } = await params
  const body = await req.json()

  const serviceSupabase = await createServiceClient()

  // Verify ownership
  const { data: agent } = await serviceSupabase
    .from('ai_employees')
    .select('id, tenant_id')
    .eq('id', agentId)
    .single()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { data: tenant } = await serviceSupabase
    .from('tenants')
    .select('id')
    .eq('id', agent.tenant_id)
    .eq('user_id', user.id)
    .single()

  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const allowed = [
    'name', 'greeting', 'personality', 'personality_score', 'voice', 'system_prompt', 'status',
    'business_name', 'industry', 'website', 'phone', 'email', 'address', 'city', 'state', 'zip',
    'business_hours', 'timezone', 'forward_to_phone',
  ]

  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { error } = await serviceSupabase
    .from('ai_employees')
    .update(updates)
    .eq('id', agentId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}

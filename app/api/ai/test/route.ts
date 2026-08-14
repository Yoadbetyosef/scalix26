import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { runAIPipeline } from '@/lib/anthropic/pipeline'
import { createAdminClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { message, conversationId, agentId } = await req.json()
  if (!message?.trim()) return NextResponse.json({ error: 'Message required' }, { status: 400 })

  // Active workspace (owner tenant, or the client tenant a White Label partner is operating).
  const activeTenantId = await getActiveTenantId()
  if (!activeTenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  const tenant = { id: activeTenantId }

  // WHICH EMPLOYEE THE SANDBOX IS TALKING TO.
  //
  // Absent = the tenant's default agent, exactly as before. Supplied, it is VERIFIED against the
  // active tenant before it is used: an agent id is a client-supplied value, and a sandbox that will
  // speak as any id it is handed would answer as another business's employee, with that business's
  // prompt and knowledge base.
  let verifiedAgentId: string | undefined
  if (typeof agentId === 'string' && agentId) {
    const { data: owned } = await createAdminClient()
      .from('ai_employees').select('id').eq('id', agentId).eq('tenant_id', tenant.id).maybeSingle()
    if (!owned) return NextResponse.json({ error: 'Unknown employee' }, { status: 404 })
    verifiedAgentId = owned.id
  }

  try {
    const result = await runAIPipeline({
      tenantId: tenant.id,
      agentId: verifiedAgentId,
      channelType: 'sms',
      from: 'test-user',
      messageContent: message,
      conversationId,
    })

    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'AI pipeline failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

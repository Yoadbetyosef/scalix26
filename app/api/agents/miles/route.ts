import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { ensureMilesAgent } from '@/lib/persona/provision'
import { agentByPersona } from '@/lib/agents/primary'

// Hire the messages employee. Idempotent — calling it twice returns the same row, `created: false`.
//
// Admin client for the same reason /api/agents/create uses one: createServiceClient is cookie-based
// and downgrades to the operator's JWT when a White Label partner is operating a client workspace, so
// the insert would land on the wrong tenant or fail RLS. Scoped entirely by the resolved tenant id.

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await getActiveTenantId()
  if (!tenantId) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const result = await ensureMilesAgent(createAdminClient(), tenantId)
  if (!result.ok) {
    const status = result.reason === 'plan_limit' ? 403 : result.reason === 'no_tenant' ? 404 : 500
    return NextResponse.json({ error: result.message, code: result.reason }, { status })
  }
  return NextResponse.json({ success: true, agent: result.agent, created: result.created })
}

/** Does this tenant have Miles? The panel needs to know before it offers to hire him. */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await getActiveTenantId()
  if (!tenantId) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const agent = await agentByPersona<{ id: string; name: string }>(
    createAdminClient(), tenantId, 'miles', 'id, name',
  )
  return NextResponse.json({ hired: !!agent, agent: agent ?? null })
}

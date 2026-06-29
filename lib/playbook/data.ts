import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentRow = Record<string, any>

export interface AgentCtx {
  admin: SupabaseClient
  agent: AgentRow
  tenantId: string
  tenant: AgentRow
}

export type AuthResult = AgentCtx | { error: string; status: 401 | 403 | 404 }

/**
 * Resolve + authorize an AI employee for the logged-in owner. Tenant ownership is checked
 * by construction: we load the agent with the service role, then confirm its tenant
 * belongs to THIS user (`tenants.user_id = user.id`). Every downstream query must keep
 * filtering by the returned tenantId — the admin client bypasses RLS.
 */
export async function authAgent(agentId: string): Promise<AuthResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 }

  const admin = createAdminClient()
  // select('*') so the page still works before the playbook migration is applied
  // (missing columns simply won't be present rather than throwing).
  const { data: agent } = await admin.from('ai_employees').select('*').eq('id', agentId).single()
  if (!agent) return { error: 'Agent not found', status: 404 }

  const { data: tenant } = await admin
    .from('tenants').select('*')
    .eq('id', agent.tenant_id).eq('user_id', user.id).single()
  if (!tenant) return { error: 'Forbidden', status: 403 }

  return { admin, agent, tenant, tenantId: agent.tenant_id }
}

export function isAuthError(r: AuthResult): r is { error: string; status: 401 | 403 | 404 } {
  return 'error' in r
}

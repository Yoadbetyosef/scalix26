import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
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
 * Resolve + authorize an AI employee for the ACTIVE business (owner tenant, or the client tenant a
 * White Label partner is operating). Tenant ownership is validated by the shared server context — the
 * agent's tenant must equal the active tenant — NOT by the logged-in user's user_id (which would resolve
 * to the operator's own tenant in operator mode). Every downstream query keeps filtering by tenantId.
 */
export async function authAgent(agentId: string): Promise<AuthResult> {
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return { error: 'Unauthorized', status: 401 }

  const admin = createAdminClient()
  // select('*') so the page still works before the playbook migration is applied
  // (missing columns simply won't be present rather than throwing).
  const { data: agent } = await admin.from('ai_employees').select('*').eq('id', agentId).single()
  if (!agent) return { error: 'Agent not found', status: 404 }
  if (agent.tenant_id !== ctx.tenantId) return { error: 'Forbidden', status: 403 }

  const { data: tenant } = await admin.from('tenants').select('*').eq('id', ctx.tenantId).single()
  if (!tenant) return { error: 'Forbidden', status: 403 }

  return { admin, agent, tenant, tenantId: ctx.tenantId }
}

export function isAuthError(r: AuthResult): r is { error: string; status: 401 | 403 | 404 } {
  return 'error' in r
}

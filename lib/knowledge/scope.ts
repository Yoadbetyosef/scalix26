// Business Knowledge ownership model (tenant-owned).
//
//   * ai_employee_id IS NULL    -> TENANT-WIDE shared knowledge (every AI Employee sees it).
//   * ai_employee_id = <agent>  -> OPTIONAL agent-specific knowledge (that agent only, in
//                                  ADDITION to the shared tenant knowledge).
//
// tenant_id is always the authoritative ownership/isolation boundary (also enforced by RLS).
// This module is the single source of truth for how reads scope and how writes default, so the
// same rule is applied everywhere and can be unit-tested.

// PostgREST `.or()` argument for "tenant-wide OR this agent". Combine with `.eq('tenant_id', t)`:
//   query.eq('tenant_id', tenantId).or(agentKnowledgeOrFilter(agentId))
// yields  tenant_id = t AND (ai_employee_id IS NULL OR ai_employee_id = agent).
// With no agent context, returns only tenant-wide rows.
export function agentKnowledgeOrFilter(agentId: string | null | undefined): string {
  return agentId
    ? `ai_employee_id.is.null,ai_employee_id.eq.${agentId}`
    : 'ai_employee_id.is.null'
}

// Ownership for a NEW knowledge row. Default is SHARED (tenant-wide); callers pass agentId only
// when the user explicitly chose "Only this AI Employee".
export function knowledgeOwnerForWrite(shared: boolean, agentId: string | null): string | null {
  return shared ? null : (agentId ?? null)
}

// Pure predicate mirroring the read filter — used by tests and any in-memory filtering.
export function knowledgeRowVisibleTo(
  row: { tenant_id: string; ai_employee_id: string | null },
  tenantId: string,
  agentId: string | null,
): boolean {
  if (row.tenant_id !== tenantId) return false // cross-tenant: always denied
  return row.ai_employee_id === null || row.ai_employee_id === agentId // shared OR this agent
}

export type KnowledgeVisibility = 'shared' | 'agent'
export const knowledgeVisibility = (aiEmployeeId: string | null): KnowledgeVisibility =>
  aiEmployeeId === null ? 'shared' : 'agent'

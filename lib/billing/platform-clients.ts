// countActiveClients — THE single source of truth for how many clients a White Label partner is billed
// the $97/mo platform fee for. Nothing else may count active clients; the subscription quantity, the
// dashboard, and the admin MRR all derive from this one function.
//
// A client is ACTIVE when ALL hold (per spec): the business (tenant) EXISTS, is NOT deleted (a hard-
// deleted tenant simply isn't returned), is NOT suspended (tenants.suspended_at IS NULL), its White
// Label owner is this partner (tenants.white_label_partner_id = partnerId), AND its partner_clients row
// status = 'active'. Anything else (paused / churned / prospect / suspended / no client row) is INACTIVE.
//
// DB access is behind an injectable `deps` seam so the counting rule is fully unit-testable with no DB.

export interface ClientCounts {
  activeClients: number
  inactiveClients: number
  totalClients: number
}

export interface ClientCountDeps {
  // Every EXISTING tenant owned by this partner (the businesses). suspended_at NULL = not suspended.
  loadPartnerTenants(partnerId: string): Promise<Array<{ id: string; suspended_at: string | null }>>
  // tenant_ids of this partner's clients whose partner_clients.status = 'active'.
  loadActiveClientTenantIds(partnerId: string): Promise<string[]>
}

const dbDeps: ClientCountDeps = {
  async loadPartnerTenants(partnerId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient()
      .from('tenants').select('id, suspended_at').eq('white_label_partner_id', partnerId)
    return (data as Array<{ id: string; suspended_at: string | null }>) || []
  },
  async loadActiveClientTenantIds(partnerId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient()
      .from('partner_clients').select('tenant_id')
      .eq('partner_id', partnerId).eq('status', 'active').not('tenant_id', 'is', null)
    return ((data as Array<{ tenant_id: string }>) || []).map((r) => r.tenant_id)
  },
}

let deps: ClientCountDeps = dbDeps
export function __setClientCountDepsForTests(d: ClientCountDeps | null) { deps = d ?? dbDeps }

export async function countActiveClients(partnerId: string): Promise<ClientCounts> {
  const [tenants, activeIds] = await Promise.all([
    deps.loadPartnerTenants(partnerId),
    deps.loadActiveClientTenantIds(partnerId),
  ])
  const active = new Set(activeIds)
  const total = tenants.length
  // Active = business exists (in `tenants`) AND not suspended AND has an active partner_clients row.
  const activeClients = tenants.filter((t) => t.suspended_at == null && active.has(t.id)).length
  return { activeClients, inactiveClients: total - activeClients, totalClients: total }
}

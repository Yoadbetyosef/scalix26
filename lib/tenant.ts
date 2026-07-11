import { createAdminClient } from '@/lib/supabase/server'
import { enabledModulesOf, effectiveModules, type ModuleKey } from '@/lib/modules'
import { getModuleFlags } from '@/lib/admin/module-flags'
import { getActiveTenantId } from '@/lib/workspace'

/**
 * The EFFECTIVE modules for the ACTIVE workspace (server components / route layouts): the business's
 * own enabled set, filtered by the global feature-flag state (disabled → hidden everywhere;
 * enterprise → Enterprise-tagged businesses only). Resolves via the active-workspace resolver, so a
 * White Label operator sees the client tenant's modules. No tenant → all modules (fail-open).
 */
export async function getTenantEnabledModules(): Promise<ModuleKey[]> {
  const tenantId = await getActiveTenantId()
  if (!tenantId) return enabledModulesOf(null)

  // Admin (true service-role) client: createServiceClient downgrades to the operator's JWT under RLS
  // and would resolve to the partner's OWN tenant, so a WL operator would see the wrong modules. The
  // server-validated tenantId is the sole scope.
  const svc = createAdminClient()
  const { data } = await svc
    .from('tenants')
    .select('enabled_modules, tags')
    .eq('id', tenantId)
    .maybeSingle()

  const flags = await getModuleFlags()
  const isEnterprise = Array.isArray(data?.tags) && data.tags.includes('Enterprise')
  return effectiveModules(enabledModulesOf(data), flags, isEnterprise)
}

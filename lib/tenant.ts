import { createClient, createServiceClient } from '@/lib/supabase/server'
import { enabledModulesOf, effectiveModules, type ModuleKey } from '@/lib/modules'
import { getModuleFlags } from '@/lib/admin/module-flags'

/**
 * The EFFECTIVE modules for the currently logged-in user's tenant (server components / route
 * layouts): the business's own enabled set, filtered by the global feature-flag state
 * (disabled → hidden everywhere; enterprise → Enterprise-tagged businesses only). No tenant /
 * no user → all modules (fail-open, backward-compatible).
 */
export async function getTenantEnabledModules(): Promise<ModuleKey[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return enabledModulesOf(null)

  const svc = await createServiceClient()
  const { data } = await svc
    .from('tenants')
    .select('enabled_modules, tags')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const flags = await getModuleFlags()
  const isEnterprise = Array.isArray(data?.tags) && data.tags.includes('Enterprise')
  return effectiveModules(enabledModulesOf(data), flags, isEnterprise)
}

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { enabledModulesOf, type ModuleKey } from '@/lib/modules'

/**
 * The enabled modules for the currently logged-in user's tenant (server components / route
 * layouts). Mirrors the tenant lookup used in the dashboard: authenticated user → their most
 * recent tenant row. No tenant / no user → all modules (fail-open, backward-compatible).
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
    .select('enabled_modules')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return enabledModulesOf(data)
}

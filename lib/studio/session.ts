import { createClient, createAdminClient } from '@/lib/supabase/server'
import { enabledModulesOf } from '@/lib/modules'
import { getActiveTenantId } from '@/lib/workspace'

export interface StudioSession { tenantId: string; email: string }

/**
 * The single gate for every /api/studio route. Resolves the ACTIVE workspace's tenant (owner tenant,
 * or the client tenant a White Label partner is operating) and enforces the `studio` module is on.
 * Returns null when unauthenticated, no tenant, or the module is off. Mirrors requireCatalogTenant.
 */
export async function requireStudioTenant(): Promise<StudioSession | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null

  const tenantId = await getActiveTenantId()
  if (!tenantId) return null

  // Admin client (not service client) so a White Label operator sees the CLIENT tenant's catalog.
  const { data } = await createAdminClient()
    .from('tenants')
    .select('id, enabled_modules')
    .eq('id', tenantId)
    .maybeSingle()

  if (!data || !enabledModulesOf(data).includes('studio')) return null
  return { tenantId: data.id, email: user.email }
}

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { enabledModulesOf } from '@/lib/modules'
import { getActiveTenantId } from '@/lib/workspace'

export interface CatalogSession { tenantId: string; email: string }

/**
 * The single gate for every catalog API route: resolves the ACTIVE workspace's tenant (owner tenant,
 * or the client tenant a White Label partner is operating) AND enforces that the `inventory` module is
 * enabled for it. Returns null when unauthenticated, has no tenant, or the module is off — so catalog
 * data is never reachable otherwise. All catalog queries scope by the returned tenantId (server-resolved).
 */
export async function requireCatalogTenant(): Promise<CatalogSession | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null

  // Active-workspace aware (getActiveTenantId) + admin client — createServiceClient would RLS-scope to
  // the operator's own tenant and hide/deny the client's catalog.
  const tenantId = await getActiveTenantId()
  if (!tenantId) return null
  const { data } = await createAdminClient()
    .from('tenants')
    .select('id, enabled_modules')
    .eq('id', tenantId)
    .maybeSingle()

  if (!data || !enabledModulesOf(data).includes('inventory')) return null
  return { tenantId: data.id, email: user.email }
}

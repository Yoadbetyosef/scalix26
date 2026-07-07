import { createClient, createServiceClient } from '@/lib/supabase/server'
import { enabledModulesOf } from '@/lib/modules'

export interface CatalogSession { tenantId: string; email: string }

/**
 * The single gate for every catalog API route: resolves the logged-in user's tenant AND
 * enforces that the `inventory` module is enabled for it. Returns null when unauthenticated,
 * has no tenant, or the module is off — so catalog data is never reachable otherwise.
 * All catalog queries scope by the returned tenantId (server-resolved, never client-supplied).
 */
export async function requireCatalogTenant(): Promise<CatalogSession | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null

  const svc = await createServiceClient()
  const { data } = await svc
    .from('tenants')
    .select('id, enabled_modules')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data || !enabledModulesOf(data).includes('inventory')) return null
  return { tenantId: data.id, email: user.email }
}

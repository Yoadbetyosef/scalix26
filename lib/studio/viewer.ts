import { createClient, createAdminClient } from '@/lib/supabase/server'
import { enabledModulesOf } from '@/lib/modules'
import { getActiveTenantId } from '@/lib/workspace'

/**
 * May the CURRENT session edit this tenant's studio products?
 *
 * This is the whole of the staff/public decision on /p/[token], and it is deliberately a server
 * function with no input from the page but the tenant id that the TOKEN resolved to. Nothing the
 * visitor controls takes part: not a query string, not a header, not a cookie we read ourselves.
 *
 * Three conditions, all server-side:
 *   1. there is a signed-in user (the Supabase session cookie verifies against the auth server),
 *   2. their ACTIVE workspace is this product's tenant — getActiveTenantId() is the same resolver
 *      the rest of the app uses, so a White Label operator inside a client workspace gets that
 *      client, and a forged/stale active_ws cookie is already inert there,
 *   3. that tenant has the studio module on.
 *
 * A visitor with no session, or a signed-in user from ANOTHER business, fails at (1) or (2) and is
 * handed the ordinary read-only page. Note this returns false rather than throwing or redirecting:
 * /p/ is a public route and must stay one — a customer scanning a QR in a showroom has no account
 * and must never meet a login screen.
 *
 * It is NOT the write gate. Every save still goes through /api/studio/*, which re-checks
 * requireStudioTenant() and scopes by tenant_id. This only decides whether to draw the controls.
 */
export async function canEditStudioTenant(tenantId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return false

  const activeTenantId = await getActiveTenantId()
  if (!activeTenantId || activeTenantId !== tenantId) return false

  const { data } = await createAdminClient()
    .from('tenants').select('id, enabled_modules').eq('id', tenantId).maybeSingle()
  return !!data && enabledModulesOf(data).includes('studio')
}

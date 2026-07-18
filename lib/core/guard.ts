import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { enabledModulesOf, type ModuleKey } from '@/lib/modules'

// Single gate for Core customer-layer routes/services. Resolves the ACTIVE workspace tenant (owner or
// WL-operator, server-validated) and enforces the required module. Returns null → callers 403/404.
// All Core repositories scope by the returned tenantId (never trust a client-supplied tenant_id).
export interface CoreCtx { tenantId: string; actor: string }

export async function requireCoreTenant(module: ModuleKey = 'contacts'): Promise<CoreCtx | null> {
  const c = await requireActiveBusinessContext()
  if (!c?.tenantId) return null
  const { data } = await createAdminClient().from('tenants').select('id, enabled_modules').eq('id', c.tenantId).maybeSingle()
  if (!data || !enabledModulesOf(data).includes(module)) return null
  return { tenantId: data.id as string, actor: c.actorUserId }
}

// Active-tenant gate without a specific module requirement — for cross-cutting Core surfaces (sales
// lifecycle, config) that aren't tied to one product module.
export async function requireCore(): Promise<CoreCtx | null> {
  const c = await requireActiveBusinessContext()
  if (!c?.tenantId) return null
  return { tenantId: c.tenantId, actor: c.actorUserId }
}

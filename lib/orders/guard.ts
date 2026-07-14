import { requireActiveBusinessContext } from '@/lib/workspace'
import { getTenantEnabledModules } from '@/lib/tenant'

// Orders is tenant-gated. Access requires an authenticated active tenant that has the `orders` module enabled.
// Returns null otherwise — callers respond 404 (never reveal the module to tenants without it).
export async function requireOrdersAccess(): Promise<{ tenantId: string; actor: string } | null> {
  const c = await requireActiveBusinessContext()
  if (!c) return null
  const modules = await getTenantEnabledModules()
  if (!modules.includes('orders')) return null
  return { tenantId: c.tenantId, actor: c.actorUserId }
}

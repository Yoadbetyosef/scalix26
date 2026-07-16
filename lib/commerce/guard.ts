import { requireActiveBusinessContext } from '@/lib/workspace'
import { getTenantEnabledModules } from '@/lib/tenant'
import { hasCommercePermission, type CommercePermission } from './permissions'

export interface CommerceContext { tenantId: string; actor: string }

// Commerce is tenant-gated. Access requires an authenticated ACTIVE tenant that has the `commerce`
// module enabled. Returns null otherwise → callers respond 404 (never reveal the module to tenants
// without it). Server-enforced, not just hidden in the UI.
export async function requireCommerceAccess(): Promise<CommerceContext | null> {
  const c = await requireActiveBusinessContext()
  if (!c) return null
  const modules = await getTenantEnabledModules()
  if (!modules.includes('commerce')) return null
  return { tenantId: c.tenantId, actor: c.actorUserId }
}

// Permission gate on top of module access. V1: the owner (role null) holds every permission, so this
// currently only enforces module access; it is the seam where future multi-user roles plug in.
export async function requireCommercePermission(perm: CommercePermission): Promise<CommerceContext | null> {
  const ctx = await requireCommerceAccess()
  if (!ctx) return null
  if (!hasCommercePermission(perm, null)) return null // future: resolve caller's commerce role
  return ctx
}

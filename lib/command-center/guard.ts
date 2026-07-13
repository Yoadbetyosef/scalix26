import { getAdminContext } from '@/lib/admin/rbac'
import { isFounderEmail } from '@/lib/admin/emails'

// CEO Command Center access control — founder-confidential. Access requires BOTH:
//   1) the env feature flag CEO_COMMAND_CENTER_ENABLED === 'true', AND
//   2) the authenticated user is on the founder allow-list (SUPER_ADMINS, not generic admin roles).
// Enforced server-side in the module layout AND every /api/admin/command-center route. Unauthorized users
// get a 404 (via notFound() for pages, 404 JSON for APIs) — the route's existence is never revealed.

export function commandCenterEnabled(): boolean {
  return process.env.CEO_COMMAND_CENTER_ENABLED === 'true'
}

// PURE predicate (unit-testable without a DB/session): both conditions must hold.
export function founderAccessAllowed(opts: { enabled: boolean; email?: string | null }): boolean {
  return opts.enabled && isFounderEmail(opts.email)
}

export interface FounderContext { email: string }

// Resolve the founder context, or null if the flag is off OR the user is not a founder.
export async function getFounderContext(): Promise<FounderContext | null> {
  const enabled = commandCenterEnabled()
  if (!enabled) return null
  const ctx = await getAdminContext()
  if (!founderAccessAllowed({ enabled, email: ctx?.email })) return null
  return { email: ctx!.email }
}

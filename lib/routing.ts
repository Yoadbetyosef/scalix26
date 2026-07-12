import { createClient } from '@/lib/supabase/server'
import { getActiveWorkspace } from '@/lib/workspace'
import { getPartnerContext } from '@/lib/partner/rbac'

// THE single post-login / root destination resolver. Business ownership ALWAYS wins over partner
// status — a partner (or admin) record must NEVER hijack the main application route. Priority:
//   1. Active operator workspace (operating a client business) → /dashboard (that business)
//   2. Owned / accessible business tenant                       → /dashboard
//   3. Partner-only account with no business tenant            → /partner
//   4. Signed out                                              → /auth/login
// An authenticated user with no tenant and no partner falls through to /dashboard (the normal
// business app, which handles onboarding) — never to /partner or /partner/signup.
//
// This is the ONLY place root routing is decided. Layouts must not re-implement it.
export async function resolveRootDestination(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return '/auth/login'

  // getActiveWorkspace().tenantId is non-null for BOTH an operator's active client workspace AND the
  // user's OWN tenant — so a single check covers priorities 1 and 2 and keeps business ownership first.
  const ws = await getActiveWorkspace()
  if (ws.tenantId) return '/dashboard'

  // No business tenant → and ONLY then → does partner status route to the partner console.
  const ctx = await getPartnerContext()
  if (ctx) return '/partner'

  return '/dashboard'
}

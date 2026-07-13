// Platform admin allow-list — the single source of truth for who can reach /admin and
// /api/admin. Used by BOTH the middleware (proxy.ts → lib/supabase/middleware) and the
// server-side isAdmin() check, so the two can never disagree.
//
// SUPER_ADMINS are ALWAYS admins, hardcoded, regardless of environment configuration. This
// is deliberate: env vars can be empty, misconfigured, or stale-baked into an older
// deployment, which would silently lock the platform owner out of the admin panel. Extra
// admins can still be added via the ADMIN_EMAILS env var (comma-separated).
const SUPER_ADMINS = ['yoadbetyosef@gmail.com']

export const ADMIN_EMAILS: string[] = Array.from(
  new Set(
    [...SUPER_ADMINS, ...(process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim())]
      .map((e) => e.toLowerCase())
      .filter(Boolean),
  ),
)

export function isAdminEmail(email?: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase())
}

// The FOUNDER allow-list — a strict subset of admins (SUPER_ADMINS only, NOT support/sales/dev roles).
// This is the single source of truth for the CEO Command Center's founder-confidential surface.
export const FOUNDER_EMAILS: string[] = SUPER_ADMINS.map((e) => e.toLowerCase())
export function isFounderEmail(email?: string | null): boolean {
  return !!email && FOUNDER_EMAILS.includes(email.toLowerCase())
}

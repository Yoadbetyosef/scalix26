import { isAdminEmail } from '@/lib/admin/emails'

// WHO MAY REACH /v2.
//
// ── THIS IS AN EXPOSURE BOUNDARY, NOT AN AUTHORIZATION ONE ──────────────────────────────────────
//
// Say that plainly, because the fix for the other thing is much bigger and somebody will otherwise
// find this file and build it.
//
// Every /v2 write is ALREADY tenant-scoped and was before this existed: takeover, send and
// stop-followups go through requireActiveBusinessContext(), and the drafts route through
// getActiveTenantId(). A signed-in user who typed /v2/inbox could never touch another business's
// customers, and cannot now. There is no leak here and there never was.
//
// What they COULD do is use unfinished software on their OWN customers — /v2 stopped being read-only
// when the composer was wired, and it now sends messages, stops follow-up sequences and marks leads
// booked. That is the risk this gate addresses: the wrong people using a preview that writes, not
// the wrong people seeing data. Treat a failure here as "somebody saw an unfinished screen", not as
// a breach.
//
// ── WHY TENANT AND NOT EMAIL ────────────────────────────────────────────────────────────────────
//
// The blast radius of every new /v2 write is one tenant's customer list, so the unit of the gate is
// the unit of the blast radius. A rollout is "this business gets v2", not "this person does" — with
// an email list, three staff at one business means remembering three, and missing one means that
// business runs two different products at once.
//
// It also composes with the operator plane for free: getActiveTenantId() returns the ACTIVE
// workspace, so a White Label partner who has switched into a client tenant is judged by THAT
// client's tenant. An email list would carry /v2 into every workspace they operate.
//
// ── ADMINS ALWAYS PASS ──────────────────────────────────────────────────────────────────────────
//
// The same reasoning lib/admin/emails.ts already gives for hardcoding SUPER_ADMINS: an env var can
// be empty, mistyped, or stale-baked into an older deployment, and none of those should lock the
// people who build it out of the preview. It is also what makes an EMPTY V2_TENANT_IDS the correct
// default — admins only, nothing else changes, and the gate exists from the start rather than being
// added once there is something to protect.

/** Tenant ids allowed to reach /v2, from the environment. Empty is the default and means admins only. */
export const V2_TENANT_IDS: string[] = Array.from(
  new Set(
    (process.env.V2_TENANT_IDS || '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  ),
)

/**
 * May this session reach /v2?
 *
 * Both arguments come from the request being served — the ACTIVE tenant, not the user's own, and the
 * signed-in email. Either qualifying is enough.
 */
export function v2Allowed(tenantId: string | null | undefined, email: string | null | undefined): boolean {
  if (isAdminEmail(email)) return true
  return !!tenantId && V2_TENANT_IDS.includes(tenantId.toLowerCase())
}

/**
 * Where a blocked visitor goes, as an ABSOLUTE url.
 *
 * proxy.ts rewrites EVERY path to `/v2<path>` when the host starts with `v2.`, so a relative
 * redirect('/dashboard') from inside this tree becomes a request for v2.<domain>/dashboard, which is
 * rewritten to /v2/dashboard, which does not exist. A blocked user would get a 404 instead of their
 * dashboard — on the one host where they are most likely to have typed it.
 *
 * The preview host is not secret, and "only allowlisted tenants see /v2" should hold wherever
 * somebody types it, so the answer is to leave the host rather than to exempt it.
 */
export function mainDomainUrl(host: string | null | undefined, path = '/dashboard'): string {
  const clean = (host || '').trim()
  // Strip only the preview label. Any other host is already the main one.
  const main = clean.replace(/^v2\./, '')
  if (!main) return process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}${path}` : path
  const proto = main.startsWith('localhost') || main.startsWith('127.0.0.1') ? 'http' : 'https'
  return `${proto}://${main}${path}`
}

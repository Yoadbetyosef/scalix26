import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getPartnerContext } from '@/lib/partner/rbac'
import { resolveMembership, markAccepted } from '@/lib/team/members'
import { capabilitiesFor, intersect, type BusinessCapabilities, type TeamRole } from '@/lib/team/roles'

// Active-workspace resolver — the ONE place "which tenant is this session operating on" is decided.
//   • Normal user  → their own tenant (user_id = auth uid). Identical to the legacy inline lookup.
//   • TEAM MEMBER  → the tenant they are an ACTIVE member of, when they own none themselves.
//   • WL operator  → the client tenant they switched into, RE-VALIDATED every request against
//                    tenants.white_label_partner_id === partnerId (a stale/forged cookie is useless).
// Defaults to owner mode whenever there's no active_ws cookie, so existing behavior is unchanged and
// rollback is instant. WL_OPERATOR_ENABLED=false kills the operator path entirely.
//
// ── WHY MEMBERSHIP IS CHECKED *AFTER* OWNERSHIP, HERE AND IN get_tenant_id() ───────────────────────
//
// A business used to BE an auth user. Teams change that, and the safe way to change it is to leave the
// old answer exactly where it was and add the new one underneath. Every user who owns a tenant resolves
// through the owner lookup and never reaches the membership query, so no existing customer's
// resolution moves by a single byte. Only a user who owns nothing — who today resolves to null and
// sees nothing at all — can reach the second branch.
//
// The SQL function mirrors this order for the same reason. Two resolvers with the same precedence are
// one rule; two resolvers with different precedence are a bug waiting for the first person who belongs
// to two businesses.

export const ACTIVE_WS_COOKIE = 'active_ws'
// Fail-closed: operator mode is OFF unless WL_OPERATOR_ENABLED is explicitly 'true'. A missing or
// mistyped env var must never silently enable cross-tenant operation in production.
const OPERATOR_ENABLED = process.env.WL_OPERATOR_ENABLED === 'true'

export interface ActiveWorkspace {
  tenantId: string | null
  mode: 'owner' | 'operator'
  partnerId: string | null
  businessName?: string | null
  /**
   * The caller's role INSIDE the active business. 'owner' for the person the tenant belongs to (and
   * for every pre-teams customer, who has no membership row at all), otherwise their team role.
   * Undefined only when there is no tenant.
   */
  role?: TeamRole
  /** The tenant_members row backing a non-owner resolution — used to stamp first sign-in. */
  memberId?: string | null
  // The White Label owner of the ACTIVE tenant, if any. In operator mode this equals partnerId. In
  // owner mode it's set when the logged-in customer's OWN business is a White Label client (so the
  // whole app renders in the partner's brand and hides partner/Scalix surfaces). Null for normal Scalix.
  whiteLabelPartnerId?: string | null
}

// Wrapped in React cache() so the multiple callers within a single request render (root layout's
// generateMetadata + RootLayout for branding, AppShell for the operator bar, and the page's own
// getActiveTenantId) share ONE resolution instead of re-querying.
export const getActiveWorkspace = cache(async function getActiveWorkspace(): Promise<ActiveWorkspace> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { tenantId: null, mode: 'owner', partnerId: null }

  const jar = await cookies()
  const wsId = OPERATOR_ENABLED ? jar.get(ACTIVE_WS_COOKIE)?.value : null
  if (wsId) {
    const ctx = await getPartnerContext()
    if (ctx && ctx.status !== 'suspended') {
      const db = createAdminClient()
      const { data: t } = await db.from('tenants').select('id, white_label_partner_id, business_name, suspended_at').eq('id', wsId).maybeSingle()
      // Operate ONLY a live client the partner owns. A suspended client tenant (admin-suspended business)
      // cleanly exits to owner mode — the partner cannot operate inside a suspended workspace.
      if (t && t.white_label_partner_id === ctx.partnerId && !t.suspended_at) {
        return { tenantId: t.id, mode: 'operator', partnerId: ctx.partnerId, businessName: t.business_name, whiteLabelPartnerId: ctx.partnerId, role: 'owner' }
      }
    }
    // Invalid / not owned / partner-suspended / client-suspended → fall through to owner mode
    // (the exit route clears the cookie; a stale/forged cookie is inert).
  }

  const svc = createAdminClient()
  const { data } = await svc.from('tenants').select('id, business_name, white_label_partner_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (data) {
    return { tenantId: data.id, mode: 'owner', partnerId: null, businessName: data.business_name ?? null, whiteLabelPartnerId: data.white_label_partner_id ?? null, role: 'owner' }
  }

  // Owns nothing — are they on somebody's team? Before teams existed this returned a null tenant and
  // the caller redirected to signup, so everything below is reachable only by users who previously
  // had no access whatsoever. Nothing here can take access away from anyone.
  const membership = await resolveMembership(user.id)
  if (!membership) return { tenantId: null, mode: 'owner', partnerId: null, role: undefined }

  const { data: t } = await svc
    .from('tenants').select('id, business_name, white_label_partner_id, suspended_at')
    .eq('id', membership.tenantId).maybeSingle()
  // A member of a suspended business gets nothing, exactly as its owner does.
  if (!t || t.suspended_at) return { tenantId: null, mode: 'owner', partnerId: null, role: undefined }

  // First time we've seen them sign in — flips the Team screen from "Invited" to "Active". Deliberately
  // not awaited: it is a display timestamp, and a business must not wait on it to render.
  void markAccepted(membership.memberId)

  return {
    tenantId: t.id,
    mode: 'owner',
    partnerId: null,
    businessName: t.business_name ?? null,
    whiteLabelPartnerId: t.white_label_partner_id ?? null,
    role: membership.role,
    memberId: membership.memberId,
  }
})

// The tenant id for the current session (owner tenant, or the operated client tenant). Single choke
// point replacing scattered `eq('user_id', user.id)` tenant lookups.
export async function getActiveTenantId(): Promise<string | null> {
  return (await getActiveWorkspace()).tenantId
}

// ── The ONE server-side context every operator-reachable API/action must use ────────────────────────
// requireActiveBusinessContext() is the single source of truth for "which business is this request
// allowed to read/write, and as whom". It builds on getActiveWorkspace() (which already validates the
// active_ws cookie, verifies partner ownership of the operated tenant, rejects stale/forged/cross-tenant
// cookies, and falls back to the user's own tenant in normal owner mode). NEVER resolve tenant ownership
// from user_id, the browser RLS context, or a browser-supplied tenant_id — call this instead.
export interface ActiveBusinessContext {
  actorUserId: string
  partnerId: string | null           // set only while operating (mode === 'operator')
  tenantId: string                   // the validated active business id
  mode: 'owner' | 'operator'
  /** The actor's role in this business — 'owner' for the person it belongs to. */
  role: TeamRole
  capabilities: BusinessCapabilities
}

// Wrapped in React cache() for the same reason getActiveWorkspace() is: the AppShell now resolves the
// caller's capabilities so the sidebar can render them on the SERVER, and the page inside that shell
// usually resolves them too. Without this that is two auth.getUser() round-trips per render instead of
// one. Read-only resolution, so sharing it within a request is safe.
export const requireActiveBusinessContext = cache(async function requireActiveBusinessContext(): Promise<ActiveBusinessContext | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const ws = await getActiveWorkspace()
  if (!ws.tenantId) return null // unauthenticated / no tenant / stale / cross-tenant → rejected

  // START FROM THE TEAM ROLE. An owner — which is every pre-teams customer, and everyone with no
  // membership row — gets the full set, so this line reproduces the previous hardcoded object exactly.
  // A staff member gets the operational subset. lib/team/roles.ts owns the matrix; this only reads it.
  const teamRole: TeamRole = ws.role ?? 'owner'
  let capabilities = capabilitiesFor(teamRole)

  // Operator mode = derive from the partner role (aliased WL roles): owner/manager full; support
  // operates but not billing/ownership; finance billing only. INTERSECTED with the team role rather
  // than replacing it, so two kinds of "restricted" compose instead of the last one applied winning.
  if (ws.mode === 'operator') {
    const role = (await getPartnerContext())?.role
    capabilities = intersect(capabilities, {
      canOperate: role !== 'finance',
      canEditBilling: role === 'owner' || role === 'manager' || role === 'finance',
      canEditSettings: role === 'owner' || role === 'manager' || role === 'support' || role === 'sales' || role === 'marketing',
      // What a business pays for its stock is its own margin structure. A White Label partner operates
      // the account but is not the business, so NO partner role grants this — deliberately not derived
      // from `role` at all. product_costs RLS draws the same line in the database, so this flag is the
      // convenience, not the protection.
      canViewCosts: false,
      // Nor may a partner operating an account change WHO ELSE can get into it. Adding a login to a
      // business is the business's decision; an operator acting inside it is not the business.
      canManageTeam: false,
    })
  }
  return { actorUserId: user.id, partnerId: ws.partnerId, tenantId: ws.tenantId, mode: ws.mode, role: teamRole, capabilities }
})

// Verify a partner may ENTER/operate a given tenant (used by the switch route). Server-side only.
// Requires the tenant to be owned by this partner AND not suspended — a suspended client can't be entered.
export async function partnerOwnsTenant(partnerId: string, tenantId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('tenants').select('id, suspended_at')
    .eq('id', tenantId).eq('white_label_partner_id', partnerId).maybeSingle()
  return !!data && !data.suspended_at
}

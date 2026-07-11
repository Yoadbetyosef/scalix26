import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getPartnerContext } from '@/lib/partner/rbac'

// Active-workspace resolver — the ONE place "which tenant is this session operating on" is decided.
//   • Normal user  → their own tenant (user_id = auth uid). Identical to the legacy inline lookup.
//   • WL operator  → the client tenant they switched into, RE-VALIDATED every request against
//                    tenants.white_label_partner_id === partnerId (a stale/forged cookie is useless).
// Defaults to owner mode whenever there's no active_ws cookie, so existing behavior is unchanged and
// rollback is instant. WL_OPERATOR_ENABLED=false kills the operator path entirely.

export const ACTIVE_WS_COOKIE = 'active_ws'
const OPERATOR_ENABLED = process.env.WL_OPERATOR_ENABLED !== 'false'

export interface ActiveWorkspace {
  tenantId: string | null
  mode: 'owner' | 'operator'
  partnerId: string | null
  businessName?: string | null
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
        return { tenantId: t.id, mode: 'operator', partnerId: ctx.partnerId, businessName: t.business_name, whiteLabelPartnerId: ctx.partnerId }
      }
    }
    // Invalid / not owned / partner-suspended / client-suspended → fall through to owner mode
    // (the exit route clears the cookie; a stale/forged cookie is inert).
  }

  const svc = createAdminClient()
  const { data } = await svc.from('tenants').select('id, business_name, white_label_partner_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return { tenantId: data?.id ?? null, mode: 'owner', partnerId: null, businessName: data?.business_name ?? null, whiteLabelPartnerId: data?.white_label_partner_id ?? null }
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
  capabilities: { canOperate: boolean; canEditBilling: boolean; canEditSettings: boolean }
}

export async function requireActiveBusinessContext(): Promise<ActiveBusinessContext | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const ws = await getActiveWorkspace()
  if (!ws.tenantId) return null // unauthenticated / no tenant / stale / cross-tenant → rejected

  // Owner mode = the user's own business → full capability. Operator mode = derive from the partner role
  // (aliased WL roles): owner/manager full; support operates but not billing/ownership; finance billing only.
  let capabilities = { canOperate: true, canEditBilling: true, canEditSettings: true }
  if (ws.mode === 'operator') {
    const role = (await getPartnerContext())?.role
    capabilities = {
      canOperate: role !== 'finance',
      canEditBilling: role === 'owner' || role === 'manager' || role === 'finance',
      canEditSettings: role === 'owner' || role === 'manager' || role === 'support' || role === 'sales' || role === 'marketing',
    }
  }
  return { actorUserId: user.id, partnerId: ws.partnerId, tenantId: ws.tenantId, mode: ws.mode, capabilities }
}

// Verify a partner may ENTER/operate a given tenant (used by the switch route). Server-side only.
// Requires the tenant to be owned by this partner AND not suspended — a suspended client can't be entered.
export async function partnerOwnsTenant(partnerId: string, tenantId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('tenants').select('id, suspended_at')
    .eq('id', tenantId).eq('white_label_partner_id', partnerId).maybeSingle()
  return !!data && !data.suspended_at
}

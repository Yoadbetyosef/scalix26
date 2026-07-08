import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { PartnerContext, PartnerType, PartnerRole } from './roles'

// Server-only partner context resolution. The pure capability model + types live in
// lib/partner/roles.ts (isomorphic). We re-export them so server code can import everything
// from '@/lib/partner/rbac' as before, while client components import from '@/lib/partner/roles'.
export * from './roles'

/**
 * Resolve the current user's partner context from their session, or null if they are not an
 * active partner member. Reads partner_members/partners with the admin client because both are
 * RLS-locked (their policies depend on get_partner_id(), which reads these very tables).
 */
export async function getPartnerContext(): Promise<PartnerContext | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // Frictionless team onboarding: activate any pending invite addressed to this email.
  if (user.email) await claimPendingInvites(user.id, user.email)
  return resolvePartnerContextForUser(user.id)
}

/** Same resolution keyed by an explicit user id (used after signup / by API-key auth). */
export async function resolvePartnerContextForUser(userId: string): Promise<PartnerContext | null> {
  const svc = createAdminClient()
  const { data: member } = await svc
    .from('partner_members')
    .select('partner_id, role, status, partners(id, partner_type, status, company_name, slug, enabled_modules)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!member) return null
  const p = member.partners as unknown as { id: string; partner_type: PartnerType; status: string; company_name: string | null; slug: string; enabled_modules: string[] | null } | null
  if (!p) return null
  return {
    userId,
    partnerId: member.partner_id,
    partnerType: p.partner_type,
    role: member.role as PartnerRole,
    status: p.status,
    companyName: p.company_name,
    slug: p.slug,
    enabledModulesRaw: p.enabled_modules,
  }
}

/**
 * Bind an invited member row (user_id null, matching invited_email) to this user and activate it —
 * unless they already hold an active membership (the one-active-per-user index would reject it).
 */
async function claimPendingInvites(userId: string, email: string): Promise<void> {
  const svc = createAdminClient()
  const { data: active } = await svc.from('partner_members').select('id').eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle()
  if (active) return
  const { data: invite } = await svc.from('partner_members')
    .select('id').eq('status', 'invited').is('user_id', null).ilike('invited_email', email)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (invite) await svc.from('partner_members').update({ user_id: userId, status: 'active' }).eq('id', invite.id)
}

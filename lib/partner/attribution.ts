import { createHash, randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { logPartnerAction } from '@/lib/partner/audit'
import { awardXp, XP } from '@/lib/partner/xp'

// First-party attribution cookies. Kept first-party + SameSite=Lax so they survive the redirect
// from /api/r/[code] into the signup page (and OAuth round-trips). The server reads them
// authoritatively at signup; a small client hint can backfill from ?ref= if a cookie is missing.
export const COOKIE_FIRST = 'sx_ref_first'   // first-touch link id (set once)
export const COOKIE_LAST = 'sx_ref_last'     // last-touch link id (overwritten each click)
export const COOKIE_VID = 'sx_vid'           // stable visitor id
export const REF_MAX_AGE = 60 * 60 * 24 * 90 // 90 days
export const VID_MAX_AGE = 60 * 60 * 24 * 400

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  return createHash('sha256').update(`${ip}:${process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 8) || 'salt'}`).digest('hex').slice(0, 32)
}

export function newVisitorId(): string { return randomUUID() }

export interface AttributionCookies { firstLinkId?: string; lastLinkId?: string; visitorId?: string }

// Minimal shape shared by next/headers cookies() and NextRequest.cookies.
interface CookieReader { get(name: string): { value: string } | undefined }

export function readAttributionCookies(store: CookieReader): AttributionCookies {
  return {
    firstLinkId: store.get(COOKIE_FIRST)?.value || undefined,
    lastLinkId: store.get(COOKIE_LAST)?.value || undefined,
    visitorId: store.get(COOKIE_VID)?.value || undefined,
  }
}

/**
 * Resolve attribution for a freshly created tenant. Last-touch wins for commission ownership (we
 * store both touches). Rejects self-referrals (a partner member referring their own new business),
 * dedupes via the referrals.tenant_id unique constraint, snapshots the owning partner's default
 * commission plan, and mirrors tenants.referred_by_partner_id. Service-role. Best-effort: never
 * throws into the signup path.
 */
export async function resolveAttribution(params: {
  tenantId: string
  userId: string
  email: string
  cookies: AttributionCookies
}): Promise<void> {
  const { tenantId, userId, email, cookies } = params
  if (!cookies.lastLinkId && !cookies.firstLinkId) return
  try {
    const db = createAdminClient()
    const linkIds = [cookies.lastLinkId, cookies.firstLinkId].filter(Boolean) as string[]
    const { data: links } = await db.from('referral_links').select('id, partner_id, campaign_id').in('id', linkIds)
    const byId = Object.fromEntries((links || []).map((l) => [l.id, l]))
    const lastLink = cookies.lastLinkId ? byId[cookies.lastLinkId] : undefined
    const firstLink = cookies.firstLinkId ? byId[cookies.firstLinkId] : undefined
    const owning = lastLink || firstLink // last-touch wins
    if (!owning) return

    // Self-referral guard: the referring partner's members can't farm commission on their own biz.
    const { data: selfMember } = await db.from('partner_members').select('id')
      .eq('partner_id', owning.partner_id).eq('user_id', userId).limit(1).maybeSingle()
    const { data: partner } = await db.from('partners').select('id, contact_email, default_commission_plan_id').eq('id', owning.partner_id).maybeSingle()
    const isSelf = !!selfMember || (partner?.contact_email && partner.contact_email.toLowerCase() === email.toLowerCase())

    const now = new Date().toISOString()
    await db.from('referrals').upsert({
      partner_id: owning.partner_id,
      tenant_id: tenantId,
      first_touch_link_id: firstLink?.id || owning.id,
      last_touch_link_id: owning.id,
      first_touch_at: now,
      last_touch_at: now,
      visitor_id: cookies.visitorId || null,
      attributed_email: email,
      status: isSelf ? 'rejected' : 'signup',
      commission_plan_id: partner?.default_commission_plan_id || null,
    }, { onConflict: 'tenant_id' })

    if (!isSelf) {
      await db.from('tenants').update({ referred_by_partner_id: owning.partner_id }).eq('id', tenantId)
      await logPartnerAction(owning.partner_id, 'system', {
        action: 'referral.signup', targetType: 'tenant', targetId: tenantId, after: { email },
      })
      // Notify the partner org of the new signup.
      await db.from('partner_notifications').insert({
        partner_id: owning.partner_id, kind: 'new_customer',
        title: 'New referred signup', body: `${email} signed up through your link.`, link: '/partner/customers',
      })
      // XP: one grant per referred signup (idempotent on the tenant).
      await awardXp(owning.partner_id, 'referral_signup', XP.referral_signup, { uniqueKey: `referral_signup:${tenantId}` })
    }
  } catch (e) {
    console.error('[attribution] resolve failed:', (e as Error).message)
  }
}

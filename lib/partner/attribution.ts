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
export const COOKIE_PARTNER = 'sx_partner'   // demo-source partner id (no link)
export const COOKIE_DEMO = 'sx_demo'         // demo id that sourced the signup
export const REF_MAX_AGE = 60 * 60 * 24 * 90 // 90 days
export const VID_MAX_AGE = 60 * 60 * 24 * 400

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  return createHash('sha256').update(`${ip}:${process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 8) || 'salt'}`).digest('hex').slice(0, 32)
}

export function newVisitorId(): string { return randomUUID() }

export interface AttributionCookies { firstLinkId?: string; lastLinkId?: string; visitorId?: string; partnerId?: string; demoId?: string }

// Minimal shape shared by next/headers cookies() and NextRequest.cookies.
interface CookieReader { get(name: string): { value: string } | undefined }

export function readAttributionCookies(store: CookieReader): AttributionCookies {
  return {
    firstLinkId: store.get(COOKIE_FIRST)?.value || undefined,
    lastLinkId: store.get(COOKIE_LAST)?.value || undefined,
    visitorId: store.get(COOKIE_VID)?.value || undefined,
    partnerId: store.get(COOKIE_PARTNER)?.value || undefined,
    demoId: store.get(COOKIE_DEMO)?.value || undefined,
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
  // Attribution can come from a referral LINK (click) or a DEMO (partner cookie, no link).
  if (!cookies.lastLinkId && !cookies.firstLinkId && !cookies.partnerId) return
  try {
    const db = createAdminClient()
    const linkIds = [cookies.lastLinkId, cookies.firstLinkId].filter(Boolean) as string[]
    const { data: links } = linkIds.length ? await db.from('referral_links').select('id, partner_id, campaign_id, creative_id').in('id', linkIds) : { data: [] }
    const byId = Object.fromEntries((links || []).map((l) => [l.id, l]))
    const lastLink = cookies.lastLinkId ? byId[cookies.lastLinkId] : undefined
    const firstLink = cookies.firstLinkId ? byId[cookies.firstLinkId] : undefined
    // Owning partner: last-touch link wins; else the demo-source partner cookie.
    const owningPartnerId = lastLink?.partner_id || firstLink?.partner_id || cookies.partnerId
    if (!owningPartnerId) return

    // Self-referral guard: the referring partner's members can't farm commission on their own biz.
    const { data: selfMember } = await db.from('partner_members').select('id')
      .eq('partner_id', owningPartnerId).eq('user_id', userId).limit(1).maybeSingle()
    const { data: partner } = await db.from('partners').select('id, contact_email, default_commission_plan_id').eq('id', owningPartnerId).maybeSingle()
    if (!partner) return
    const isSelf = !!selfMember || (partner.contact_email && partner.contact_email.toLowerCase() === email.toLowerCase())

    // Marketing OS: carry campaign + creative from the owning link (or the demo) so the customer
    // traces back to the exact creative/campaign that acquired them.
    let campaignId = (lastLink as { campaign_id?: string } | undefined)?.campaign_id || (firstLink as { campaign_id?: string } | undefined)?.campaign_id || null
    let creativeId = (lastLink as { creative_id?: string } | undefined)?.creative_id || (firstLink as { creative_id?: string } | undefined)?.creative_id || null
    if (cookies.demoId && (!campaignId || !creativeId)) {
      const { data: demo } = await db.from('demos').select('campaign_id, creative_id').eq('id', cookies.demoId).maybeSingle()
      campaignId = campaignId || demo?.campaign_id || null
      creativeId = creativeId || demo?.creative_id || null
    }

    const now = new Date().toISOString()
    await db.from('referrals').upsert({
      partner_id: owningPartnerId,
      tenant_id: tenantId,
      first_touch_link_id: firstLink?.id || lastLink?.id || null,
      last_touch_link_id: lastLink?.id || firstLink?.id || null,
      first_touch_at: now,
      last_touch_at: now,
      visitor_id: cookies.visitorId || null,
      attributed_email: email,
      status: isSelf ? 'rejected' : 'signup',
      commission_plan_id: partner.default_commission_plan_id || null,
      demo_id: cookies.demoId || null,
      campaign_id: campaignId,
      creative_id: creativeId,
    }, { onConflict: 'tenant_id' })

    if (!isSelf) {
      await db.from('tenants').update({ referred_by_partner_id: owningPartnerId }).eq('id', tenantId)

      // Demo → customer: mark the demo as trial-converted + log the funnel event.
      if (cookies.demoId) {
        await db.from('demos').update({ converted_trial: true }).eq('id', cookies.demoId).eq('partner_id', owningPartnerId)
        await db.from('demo_events').insert({ demo_id: cookies.demoId, partner_id: owningPartnerId, event_type: 'signup', meta: { email } }).then(() => {}, () => {})
      }
      await logPartnerAction(owningPartnerId, 'system', {
        action: 'referral.signup', targetType: 'tenant', targetId: tenantId, after: { email, source: cookies.demoId ? 'demo' : 'link' },
      })
      // Notify the partner org of the new signup.
      await db.from('partner_notifications').insert({
        partner_id: owningPartnerId, kind: 'new_customer',
        title: 'New referred signup', body: `${email} signed up${cookies.demoId ? ' from your demo' : ' through your link'}.`, link: '/partner/customers',
      })
      // XP: one grant per referred signup (idempotent on the tenant).
      await awardXp(owningPartnerId, 'referral_signup', XP.referral_signup, { uniqueKey: `referral_signup:${tenantId}` })
    }
  } catch (e) {
    console.error('[attribution] resolve failed:', (e as Error).message)
  }
}

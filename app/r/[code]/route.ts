import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  COOKIE_FIRST, COOKIE_LAST, COOKIE_VID, REF_MAX_AGE, VID_MAX_AGE,
  hashIp, newVisitorId,
} from '@/lib/partner/attribution'

export const runtime = 'nodejs'

// Referral redirect + click ingestion. Returns the 302 immediately; the click insert runs in
// after() so it never blocks the visitor. Append-only, high-volume. Public route.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const origin = req.nextUrl.origin
  const db = createAdminClient()

  const { data: link } = await db.from('referral_links')
    .select('id, partner_id, destination_path, utm').eq('code', code).maybeSingle()

  // Unknown code → send to the marketing home rather than erroring.
  if (!link) return NextResponse.redirect(new URL('/', origin))

  // Build the destination with any baked-in UTM params + the ref code hint.
  const dest = new URL(link.destination_path || '/auth/signup', origin)
  const utm = (link.utm || {}) as Record<string, string>
  for (const [k, v] of Object.entries(utm)) dest.searchParams.set(k, v)
  dest.searchParams.set('ref', code)

  const res = NextResponse.redirect(dest)

  // Cookies: last-touch always; first-touch only if absent; visitor id if absent.
  const existingVid = req.cookies.get(COOKIE_VID)?.value
  const visitorId = existingVid || newVisitorId()
  const cookieBase = { httpOnly: false, sameSite: 'lax' as const, secure: true, path: '/' }
  res.cookies.set(COOKIE_LAST, link.id, { ...cookieBase, maxAge: REF_MAX_AGE })
  if (!req.cookies.get(COOKIE_FIRST)?.value) res.cookies.set(COOKIE_FIRST, link.id, { ...cookieBase, maxAge: REF_MAX_AGE })
  if (!existingVid) res.cookies.set(COOKIE_VID, visitorId, { ...cookieBase, maxAge: VID_MAX_AGE })

  const ipHash = hashIp(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim())
  const userAgent = req.headers.get('user-agent') || null
  const referer = req.headers.get('referer') || null

  after(async () => {
    try {
      await db.from('referral_clicks').insert({
        link_id: link.id, partner_id: link.partner_id, visitor_id: visitorId,
        ip_hash: ipHash, user_agent: userAgent, referer, utm,
      })
      // Denormalized counter (best-effort; exact counts come from the click table).
      await db.rpc('increment_referral_click', { p_link_id: link.id }).then(
        () => {},
        // If the RPC isn't installed, fall back to a read-modify-write (rare path).
        async () => {
          const { data: cur } = await db.from('referral_links').select('click_count').eq('id', link.id).maybeSingle()
          await db.from('referral_links').update({ click_count: (cur?.click_count || 0) + 1 }).eq('id', link.id)
        },
      )
    } catch (e) {
      console.error('[referral click] insert failed:', (e as Error).message)
    }
  })

  return res
}

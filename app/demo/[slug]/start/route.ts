import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { COOKIE_PARTNER, COOKIE_DEMO, REF_MAX_AGE } from '@/lib/partner/attribution'
import { logDemoEvent } from '@/lib/partner/demo'

export const runtime = 'nodejs'

// The demo's "Bring this to my business" CTA. Stamps demo-source attribution cookies (partner +
// demo) and sends the prospect to signup, so the resulting customer is tied to BOTH the partner
// and the exact demo that closed them. Public.
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = createAdminClient()
  const { data: demo } = await db.from('demos').select('id, partner_id').eq('public_slug', slug).maybeSingle()

  const res = NextResponse.redirect(new URL('/auth/signup', req.nextUrl.origin))
  if (demo) {
    const opts = { httpOnly: false, sameSite: 'lax' as const, secure: true, path: '/', maxAge: REF_MAX_AGE }
    res.cookies.set(COOKIE_PARTNER, demo.partner_id, opts)
    res.cookies.set(COOKIE_DEMO, demo.id, opts)
    logDemoEvent(db, demo.id, demo.partner_id, 'cta_click').catch(() => {})
  }
  return res
}

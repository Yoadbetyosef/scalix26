import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos, canWriteVia } from '@/lib/partner/roles'

const slugify = (s: string) => (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'page') + '-' + randomBytes(3).toString('hex')

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const { data } = await db.from('landing_pages').select('id, slug, headline, subhead, cta_text, view_count, campaign_id, creative_id, referral_link_id, created_at').eq('partner_id', ctx.partnerId).order('created_at', { ascending: false })
  return NextResponse.json({ pages: data || [] })
}

// Create a landing page + a referral link its CTA routes through (so clicks/signups attribute to
// this page's campaign + creative automatically).
export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx) || !canWriteVia(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.headline) return NextResponse.json({ error: 'Headline required' }, { status: 400 })
  const db = createAdminClient()

  const code = randomBytes(6).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
  const { data: link } = await db.from('referral_links').insert({
    partner_id: ctx.partnerId, code, label: `LP: ${b.headline.slice(0, 40)}`, destination_path: '/auth/signup',
    campaign_id: b.campaign_id || null, creative_id: b.creative_id || null,
  }).select('id, code').single()

  const slug = slugify(b.headline)
  const { data: page, error } = await db.from('landing_pages').insert({
    partner_id: ctx.partnerId, campaign_id: b.campaign_id || null, creative_id: b.creative_id || null,
    referral_link_id: link?.id || null, slug, headline: b.headline, subhead: b.subhead || null,
    cta_text: b.cta_text || 'Get started free', config: b.config || {},
  }).select('id, slug').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (link?.id) await db.from('referral_links').update({ landing_page_id: page.id }).eq('id', link.id)
  return NextResponse.json({ page, linkCode: link?.code })
}

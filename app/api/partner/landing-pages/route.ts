import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos, canWriteVia } from '@/lib/partner/roles'

const slugify = (s: string) => (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'page') + '-' + randomBytes(3).toString('hex')
const STATUSES = ['draft', 'published', 'archived']

// GET returns each landing page with its live metrics: views (own counter) + clicks (from the
// referral link its CTA routes through). Downstream funnel (demos/signups/paid) rolls up at the
// campaign level via attribution, so we surface campaign_id for the UI to link to.
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const [{ data: pages }, { data: campaigns }, { data: creatives }] = await Promise.all([
    db.from('landing_pages').select('id, slug, headline, subhead, cta_text, view_count, campaign_id, creative_id, referral_link_id, config, created_at, referral_links(code, click_count)').eq('partner_id', ctx.partnerId).order('created_at', { ascending: false }),
    db.from('campaigns').select('id, name').eq('partner_id', ctx.partnerId),
    db.from('creatives').select('id, title').eq('partner_id', ctx.partnerId),
  ])
  const cName = new Map((campaigns || []).map((c) => [c.id, c.name]))
  const crTitle = new Map((creatives || []).map((c) => [c.id, c.title]))
  const out = (pages || []).map((p) => {
    const link = p.referral_links as unknown as { code?: string; click_count?: number } | null
    const cfg = (p.config || {}) as { status?: string; accent?: string }
    return {
      id: p.id, slug: p.slug, headline: p.headline, subhead: p.subhead, cta_text: p.cta_text,
      views: p.view_count || 0, clicks: link?.click_count || 0, link_code: link?.code || null,
      campaign_id: p.campaign_id, campaign_name: p.campaign_id ? cName.get(p.campaign_id) || null : null,
      creative_id: p.creative_id, creative_title: p.creative_id ? crTitle.get(p.creative_id) || null : null,
      status: cfg.status || 'published', accent: cfg.accent || null, created_at: p.created_at,
    }
  })
  return NextResponse.json({ pages: out })
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
  const status = STATUSES.includes(b.status) ? b.status : 'published'
  const { data: page, error } = await db.from('landing_pages').insert({
    partner_id: ctx.partnerId, campaign_id: b.campaign_id || null, creative_id: b.creative_id || null,
    referral_link_id: link?.id || null, slug, headline: b.headline, subhead: b.subhead || null,
    cta_text: b.cta_text || 'Start free — set up your AI employee', config: { ...(b.config || {}), status },
  }).select('id, slug').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (link?.id) await db.from('referral_links').update({ landing_page_id: page.id }).eq('id', link.id)
  return NextResponse.json({ page, linkCode: link?.code })
}

// Edit copy / status. Status lives in config (no schema change).
export async function PATCH(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = createAdminClient()
  const patch: Record<string, unknown> = {}
  for (const f of ['headline', 'subhead', 'cta_text']) if (f in b && b[f]) patch[f] = b[f]
  if (b.status && STATUSES.includes(b.status)) {
    const { data: cur } = await db.from('landing_pages').select('config').eq('id', b.id).eq('partner_id', ctx.partnerId).maybeSingle()
    patch.config = { ...((cur?.config as object) || {}), status: b.status }
  }
  const { error } = await db.from('landing_pages').update(patch).eq('id', b.id).eq('partner_id', ctx.partnerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await createAdminClient().from('landing_pages').delete().eq('id', id).eq('partner_id', ctx.partnerId)
  return NextResponse.json({ success: true })
}

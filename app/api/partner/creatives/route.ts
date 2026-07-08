import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos, canWriteVia } from '@/lib/partner/roles'

const TYPES = ['ad_copy', 'headline', 'video', 'image', 'landing_page', 'email', 'sms', 'call_script', 'follow_up_sequence']
const STATUSES = ['draft', 'testing', 'winner', 'archived']

// Returns the partner's own creatives + the official Scalix library (partner_id NULL).
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const [{ data: mine }, { data: official }] = await Promise.all([
    db.from('creatives').select('*').eq('partner_id', ctx.partnerId).order('created_at', { ascending: false }),
    db.from('creatives').select('*').is('partner_id', null).order('created_at', { ascending: false }),
  ])
  return NextResponse.json({ mine: mine || [], official: official || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx) || !canWriteVia(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const db = createAdminClient()

  // Clone (from a winner or the official library) → a private draft.
  if (b.cloneFrom) {
    const { data: src } = await db.from('creatives').select('*').eq('id', b.cloneFrom).or(`partner_id.eq.${ctx.partnerId},partner_id.is.null`).maybeSingle()
    if (!src) return NextResponse.json({ error: 'Source not found' }, { status: 404 })
    const { data, error } = await db.from('creatives').insert({
      partner_id: ctx.partnerId, campaign_id: b.campaign_id || null, type: src.type, title: `${src.title} (copy)`,
      body: src.body, asset_url: src.asset_url, status: 'draft', cloned_from_id: src.id, tags: src.tags,
    }).select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ creative: data })
  }

  if (!b.title || !TYPES.includes(b.type)) return NextResponse.json({ error: 'title + valid type required' }, { status: 400 })
  const { data, error } = await db.from('creatives').insert({
    partner_id: ctx.partnerId, campaign_id: b.campaign_id || null, type: b.type, title: b.title,
    body: b.body || null, asset_url: b.asset_url || null, status: STATUSES.includes(b.status) ? b.status : 'draft', tags: Array.isArray(b.tags) ? b.tags : [],
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ creative: data })
}

export async function PATCH(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  for (const f of ['title', 'body', 'asset_url', 'campaign_id', 'tags']) if (f in b) patch[f] = b[f]
  if (b.status && STATUSES.includes(b.status)) patch.status = b.status
  const { error } = await createAdminClient().from('creatives').update(patch).eq('id', b.id).eq('partner_id', ctx.partnerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

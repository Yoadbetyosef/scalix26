import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos, canWriteVia } from '@/lib/partner/rbac'
import { scrapeBranding, buildBriefing } from '@/lib/partner/demo'
import { logPartnerAction } from '@/lib/partner/audit'

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'demo'
  return `${base}-${randomBytes(3).toString('hex')}`
}

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const { data } = await db.from('demos')
    .select('id, public_slug, prospect_name, industry, view_count, last_viewed_at, created_at')
    .eq('partner_id', ctx.partnerId).order('created_at', { ascending: false })
  return NextResponse.json({ demos: data || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx) || !canWriteVia(ctx)) return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (!body.prospectName) return NextResponse.json({ error: 'Business name is required.' }, { status: 400 })

  const branding = await scrapeBranding(body.website)
  const briefing = buildBriefing({
    prospectName: body.prospectName, website: body.website, industry: body.industry,
    phone: body.phone, hours: body.hours, faq: body.faq,
  }, branding)

  const db = createAdminClient()
  const { data: demo, error } = await db.from('demos').insert({
    partner_id: ctx.partnerId,
    lead_id: body.leadId || null,
    public_slug: slugify(body.prospectName),
    prospect_name: body.prospectName,
    website: body.website || null,
    industry: body.industry || null,
    phone: body.phone || null,
    hours: body.hours || null,
    faq: body.faq || null,
    branding,
    briefing,
    expires_at: null,
  }).select('id, public_slug, prospect_name').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // If generated from a CRM lead, auto-advance it to 'demo_sent' + log the activity.
  if (body.leadId) {
    await db.from('crm_leads').update({ stage: 'demo_sent', demo_id: demo.id, updated_at: new Date().toISOString() }).eq('id', body.leadId).eq('partner_id', ctx.partnerId)
    await db.from('crm_activities').insert({ partner_id: ctx.partnerId, lead_id: body.leadId, actor_id: ctx.userId, kind: 'demo_sent', body: `Demo generated for ${body.prospectName}`, meta: { demo_id: demo.id } })
  }

  await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'demo.created', targetType: 'demo', targetId: demo.id, after: { prospect: body.prospectName } })
  return NextResponse.json({ success: true, demo })
}

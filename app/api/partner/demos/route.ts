import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos, canWriteVia } from '@/lib/partner/rbac'
import { scrapeBranding, buildBriefing } from '@/lib/partner/demo'
import { logPartnerAction } from '@/lib/partner/audit'
import { awardXp, XP } from '@/lib/partner/xp'

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'demo'
  return `${base}-${randomBytes(3).toString('hex')}`
}

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const { data } = await db.from('demos')
    .select('id, public_slug, prospect_name, industry, mode, view_count, unique_visitors, total_dwell_ms, chat_count, engagement_score, converted_trial, converted_paid, last_viewed_at, created_at')
    .eq('partner_id', ctx.partnerId).order('created_at', { ascending: false })

  // Per-demo attribution: signups + paid + commission generated (from referrals.demo_id).
  const ids = (data || []).map((d) => d.id)
  const byDemo: Record<string, { signups: number; paid: number; commission_cents: number }> = {}
  if (ids.length) {
    const { data: refs } = await db.from('referrals').select('demo_id, status, tenant_id').in('demo_id', ids)
    const paidTenants: string[] = []
    for (const r of refs || []) {
      const k = r.demo_id as string
      byDemo[k] ||= { signups: 0, paid: 0, commission_cents: 0 }
      byDemo[k].signups++
      if (r.status === 'paid') { byDemo[k].paid++; if (r.tenant_id) paidTenants.push(r.tenant_id) }
    }
    if (paidTenants.length) {
      const { data: entries } = await db.from('commission_entries').select('tenant_id, amount_cents, status').eq('partner_id', ctx.partnerId).in('tenant_id', paidTenants)
      const tenantToDemo = Object.fromEntries((refs || []).filter((r) => r.tenant_id).map((r) => [r.tenant_id, r.demo_id]))
      for (const e of entries || []) {
        const dk = tenantToDemo[e.tenant_id as string]
        if (dk && byDemo[dk] && e.status === 'paid') byDemo[dk].commission_cents += e.amount_cents
      }
    }
  }
  return NextResponse.json({ demos: (data || []).map((d) => ({ ...d, attribution: byDemo[d.id] || { signups: 0, paid: 0, commission_cents: 0 } })) })
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

  // If generated from a CRM lead, auto-advance it to 'demo_generated' + log the activity.
  if (body.leadId) {
    await db.from('crm_leads').update({ stage: 'demo_generated', demo_id: demo.id, updated_at: new Date().toISOString() }).eq('id', body.leadId).eq('partner_id', ctx.partnerId)
    await db.from('crm_activities').insert({ partner_id: ctx.partnerId, lead_id: body.leadId, actor_id: ctx.userId, kind: 'demo_sent', body: `Demo generated for ${body.prospectName}`, meta: { demo_id: demo.id } })
  }

  await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'demo.created', targetType: 'demo', targetId: demo.id, after: { prospect: body.prospectName } })
  // XP: per-demo + a one-time bonus for the very first demo.
  await awardXp(ctx.partnerId, 'demo_created', XP.demo_created, { userId: ctx.userId })
  await awardXp(ctx.partnerId, 'first_demo_bonus', XP.first_demo_bonus, { uniqueKey: `first_demo_bonus:${ctx.partnerId}`, userId: ctx.userId })
  return NextResponse.json({ success: true, demo })
}

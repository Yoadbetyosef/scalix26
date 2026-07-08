import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canEditPipeline, canViewPipeline, canWriteVia } from '@/lib/partner/roles'
import { CRM_STAGES } from '@/lib/partner/crm'
import { logPartnerAction } from '@/lib/partner/audit'

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewPipeline(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  let q = db.from('crm_leads').select('*').eq('partner_id', ctx.partnerId).order('updated_at', { ascending: false })
  // Sales seat sees own + assigned; owner/manager see all.
  if (ctx.role === 'sales') q = q.eq('assigned_to', ctx.userId)
  const { data } = await q
  return NextResponse.json({ leads: data || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPipeline(ctx) || !canWriteVia(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.business_name) return NextResponse.json({ error: 'Business name is required.' }, { status: 400 })
  const db = createAdminClient()
  const { data, error } = await db.from('crm_leads').insert({
    partner_id: ctx.partnerId,
    assigned_to: b.assigned_to || ctx.userId,
    business_name: b.business_name,
    contact_name: b.contact_name || null,
    email: b.email || null,
    phone: b.phone || null,
    website: b.website || null,
    industry: b.industry || null,
    stage: CRM_STAGES.includes(b.stage) ? b.stage : 'lead',
    source: b.source || 'manual',
    tags: Array.isArray(b.tags) ? b.tags : [],
    estimated_mrr_cents: b.estimated_mrr_cents || null,
    notes: b.notes || null,
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'lead.created', targetType: 'lead', targetId: data.id, after: { business_name: b.business_name } })
  return NextResponse.json({ lead: data })
}

export async function PATCH(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPipeline(ctx) || !canWriteVia(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = createAdminClient()

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const fields = ['business_name', 'contact_name', 'email', 'phone', 'website', 'industry', 'source', 'notes', 'estimated_mrr_cents', 'assigned_to', 'tags']
  for (const f of fields) if (f in b) patch[f] = b[f]
  let stageChanged: string | null = null
  if (b.stage && CRM_STAGES.includes(b.stage)) { patch.stage = b.stage; stageChanged = b.stage }

  const { data, error } = await db.from('crm_leads').update(patch).eq('id', b.id).eq('partner_id', ctx.partnerId).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (stageChanged) {
    await db.from('crm_activities').insert({ partner_id: ctx.partnerId, lead_id: b.id, actor_id: ctx.userId, kind: 'stage_change', body: `Moved to ${stageChanged}`, meta: { stage: stageChanged } })
  }
  return NextResponse.json({ lead: data })
}

export async function DELETE(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPipeline(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = createAdminClient()
  await db.from('crm_leads').delete().eq('id', id).eq('partner_id', ctx.partnerId)
  return NextResponse.json({ success: true })
}

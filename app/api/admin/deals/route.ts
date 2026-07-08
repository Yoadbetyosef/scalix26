import { NextRequest, NextResponse } from 'next/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/admin/audit'

// Per-partner deals: override the default commission plan / add custom terms. Resolution order in
// the engine: active deal → referral snapshot → partner default → global default.
export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  const { data } = await db.from('partner_deals')
    .select('id, partner_id, commission_plan_id, active, note, starts_at, ends_at, created_at, partners(company_name, slug), commission_plans(name)')
    .order('created_at', { ascending: false }).limit(200)
  return NextResponse.json({ deals: data || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.partner_id) return NextResponse.json({ error: 'partner_id required' }, { status: 400 })
  const db = createAdminClient()
  const { data, error } = await db.from('partner_deals').insert({
    partner_id: b.partner_id, commission_plan_id: b.commission_plan_id || null,
    custom_terms: b.custom_terms || {}, note: b.note || null,
    starts_at: b.starts_at || null, ends_at: b.ends_at || null, active: b.active ?? true, created_by: ctx.email,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logAdminAction(ctx.email, { action: 'deal.create', targetType: 'partner', targetId: b.partner_id, after: { plan: b.commission_plan_id } })
  return NextResponse.json({ success: true, id: data.id })
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  for (const f of ['commission_plan_id', 'active', 'note', 'starts_at', 'ends_at']) if (f in b) patch[f] = b[f]
  const { error } = await createAdminClient().from('partner_deals').update(patch).eq('id', b.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logAdminAction(ctx.email, { action: 'deal.update', targetType: 'deal', targetId: b.id, after: patch })
  return NextResponse.json({ success: true })
}

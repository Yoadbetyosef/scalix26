import { NextRequest, NextResponse } from 'next/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/admin/audit'

export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  const [{ data: plans }, { data: partners }] = await Promise.all([
    db.from('commission_plans').select('*').order('created_at', { ascending: true }),
    db.from('partners').select('id, company_name, slug, default_commission_plan_id'),
  ])
  return NextResponse.json({ plans: plans || [], partners: partners || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.name || !b.model) return NextResponse.json({ error: 'name and model required' }, { status: 400 })
  const db = createAdminClient()
  const { data, error } = await db.from('commission_plans').insert({
    partner_id: b.partner_id || null, name: b.name, model: b.model,
    recurring_pct: b.recurring_pct ?? null, one_time_cents: b.one_time_cents ?? null,
    duration_months: b.duration_months ?? null, tiers: b.tiers ?? null,
    clawback_window_days: b.clawback_window_days ?? 60, currency: b.currency || 'usd', active: b.active ?? true,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // Optionally assign as a partner's default.
  if (b.partner_id && b.assignDefault) await db.from('partners').update({ default_commission_plan_id: data.id }).eq('id', b.partner_id)
  await logAdminAction(ctx.email, { action: 'commission_plan.create', targetType: 'commission_plan', targetId: data.id, after: { name: b.name } })
  return NextResponse.json({ success: true, id: data.id })
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = createAdminClient()
  const patch: Record<string, unknown> = {}
  for (const f of ['name', 'model', 'recurring_pct', 'one_time_cents', 'duration_months', 'tiers', 'clawback_window_days', 'active']) if (f in b) patch[f] = b[f]
  const { error } = await db.from('commission_plans').update(patch).eq('id', b.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // Assign as a partner's default plan.
  if (b.assignToPartner) await db.from('partners').update({ default_commission_plan_id: b.id }).eq('id', b.assignToPartner)
  await logAdminAction(ctx.email, { action: 'commission_plan.update', targetType: 'commission_plan', targetId: b.id, after: patch })
  return NextResponse.json({ success: true })
}

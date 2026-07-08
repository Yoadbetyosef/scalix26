import { NextRequest, NextResponse } from 'next/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/admin/audit'

export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data } = await createAdminClient().from('upgrade_rules').select('*').order('sort', { ascending: true })
  return NextResponse.json({ rules: data || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.name || !b.metric || b.threshold == null || !b.action) return NextResponse.json({ error: 'name, metric, threshold, action required' }, { status: 400 })
  const db = createAdminClient()
  const { data, error } = await db.from('upgrade_rules').insert({
    name: b.name, metric: b.metric, threshold: Number(b.threshold), from_type: b.from_type || null,
    to_type: b.to_type || null, to_tier: b.to_tier ?? null, action: b.action, message: b.message || null,
    active: b.active ?? true, sort: b.sort ?? 0,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logAdminAction(ctx.email, { action: 'upgrade_rule.create', targetType: 'upgrade_rule', targetId: data.id, after: { name: b.name } })
  return NextResponse.json({ success: true, id: data.id })
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  for (const f of ['name', 'metric', 'threshold', 'from_type', 'to_type', 'to_tier', 'action', 'message', 'active', 'sort']) if (f in b) patch[f] = b[f]
  const { error } = await createAdminClient().from('upgrade_rules').update(patch).eq('id', b.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logAdminAction(ctx.email, { action: 'upgrade_rule.update', targetType: 'upgrade_rule', targetId: b.id, after: patch })
  return NextResponse.json({ success: true })
}

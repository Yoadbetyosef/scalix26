import { NextRequest, NextResponse } from 'next/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/admin/audit'

export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  const { data } = await db.from('bonus_campaigns').select('*').order('created_at', { ascending: false })
  return NextResponse.json({ campaigns: data || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.name || !b.kind) return NextResponse.json({ error: 'name and kind required' }, { status: 400 })
  const db = createAdminClient()
  const { data, error } = await db.from('bonus_campaigns').insert({
    name: b.name, kind: b.kind, amount_cents: b.amount_cents ?? null, threshold: b.threshold ?? null,
    starts_at: b.starts_at || null, ends_at: b.ends_at || null, partner_type: b.partner_type || null, active: b.active ?? true,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logAdminAction(ctx.email, { action: 'bonus_campaign.create', targetType: 'bonus_campaign', targetId: data.id, after: { name: b.name } })
  return NextResponse.json({ success: true, id: data.id })
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = createAdminClient()
  const patch: Record<string, unknown> = {}
  for (const f of ['name', 'kind', 'amount_cents', 'threshold', 'starts_at', 'ends_at', 'partner_type', 'active']) if (f in b) patch[f] = b[f]
  const { error } = await db.from('bonus_campaigns').update(patch).eq('id', b.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logAdminAction(ctx.email, { action: 'bonus_campaign.update', targetType: 'bonus_campaign', targetId: b.id, after: patch })
  return NextResponse.json({ success: true })
}

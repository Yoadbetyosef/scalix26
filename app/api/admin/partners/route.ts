import { NextRequest, NextResponse } from 'next/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/admin/audit'

// Admin: list partners with rollup stats; update status/tier.
export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  const { data: partners } = await db.from('partners')
    .select('id, company_name, slug, partner_type, status, tier, health_score, contact_email, created_at')
    .order('created_at', { ascending: false }).limit(500)

  const ids = (partners || []).map((p) => p.id)
  const stats: Record<string, { customers: number; pending: number; paid: number }> = {}
  if (ids.length) {
    const [{ data: refs }, { data: entries }] = await Promise.all([
      db.from('referrals').select('partner_id, status').in('partner_id', ids),
      db.from('commission_entries').select('partner_id, amount_cents, status').in('partner_id', ids),
    ])
    for (const p of ids) stats[p] = { customers: 0, pending: 0, paid: 0 }
    for (const r of refs || []) if (r.status === 'paid') stats[r.partner_id].customers++
    for (const e of entries || []) {
      if (e.status === 'pending' || e.status === 'approved') stats[e.partner_id].pending += e.amount_cents
      if (e.status === 'paid') stats[e.partner_id].paid += e.amount_cents
    }
  }
  return NextResponse.json({ partners: (partners || []).map((p) => ({ ...p, stats: stats[p.id] || { customers: 0, pending: 0, paid: 0 } })) })
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id, status, tier } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (status && ['pending', 'active', 'suspended', 'banned'].includes(status)) patch.status = status
  if (typeof tier === 'number') patch.tier = tier
  const db = createAdminClient()
  const { error } = await db.from('partners').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logAdminAction(ctx.email, { action: 'partner.update', targetType: 'partner', targetId: id, after: patch })
  return NextResponse.json({ success: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/admin/audit'

export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  const { data } = await db.from('marketplace_reviews')
    .select('id, rating, body, status, created_at, partner_id, partners(company_name, slug)')
    .order('created_at', { ascending: false }).limit(200)
  return NextResponse.json({ reviews: data || [] })
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id, status } = await req.json().catch(() => ({}))
  if (!id || !['published', 'rejected', 'pending'].includes(status)) return NextResponse.json({ error: 'id + valid status required' }, { status: 400 })
  const db = createAdminClient()
  const { data: review } = await db.from('marketplace_reviews').update({ status }).eq('id', id).select('partner_id').single()

  // Recompute the partner's published rating average + count.
  if (review?.partner_id) {
    const { data: pub } = await db.from('marketplace_reviews').select('rating').eq('partner_id', review.partner_id).eq('status', 'published')
    const count = pub?.length || 0
    const avg = count ? Math.round((pub!.reduce((s, r) => s + r.rating, 0) / count) * 100) / 100 : null
    await db.from('marketplace_profiles').upsert({ partner_id: review.partner_id, rating_avg: avg, review_count: count, updated_at: new Date().toISOString() }, { onConflict: 'partner_id' })
  }
  await logAdminAction(ctx.email, { action: 'review.moderate', targetType: 'review', targetId: id, after: { status } })
  return NextResponse.json({ success: true })
}

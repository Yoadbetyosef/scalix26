import { NextRequest, NextResponse } from 'next/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/admin/audit'
import { executePayout } from '@/lib/partner/payout'

// Admin commission operations:
//  action=approve  → move a partner's pending entries to approved.
//  action=pay      → pay approved balance (auto Stripe transfer if enabled, else manual record).
//  action=retry    → re-attempt a payout for a partner with a failed/approved balance.
export async function POST(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { partnerId, action } = await req.json().catch(() => ({}))
  if (!partnerId || !action) return NextResponse.json({ error: 'partnerId and action required' }, { status: 400 })
  const db = createAdminClient()

  if (action === 'approve') {
    const { error } = await db.from('commission_entries').update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('partner_id', partnerId).eq('status', 'pending')
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await logAdminAction(ctx.email, { action: 'commission.approve', targetType: 'partner', targetId: partnerId })
    return NextResponse.json({ success: true })
  }

  if (action === 'pay' || action === 'retry') {
    const res = await executePayout(partnerId, { by: ctx.email })
    await logAdminAction(ctx.email, { action: `commission.${action}`, targetType: 'partner', targetId: partnerId, after: res })
    if (!res.ok) return NextResponse.json({ error: res.error, status: res.status }, { status: 400 })
    return NextResponse.json({ success: true, amount_cents: res.amount_cents, method: res.method })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

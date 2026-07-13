import { NextRequest, NextResponse } from 'next/server'
import { logAdminAction } from '@/lib/admin/audit'
import { requirePlatformAdmin } from '@/lib/admin/platform-admin-guard'
import { expirePlatformGraceIfDue } from '@/lib/billing/platform-fee'

// POST /api/admin/wl-billing/partners/[partnerId]/expire-grace — run the dunning grace-expiry sweep for a
// SINGLE partner (the per-partner equivalent of the cron's grace sweep). No new logic — it calls the
// existing expirePlatformGraceIfDue(partnerId, now); a partner whose past_due grace window has closed
// transitions to payment_required (which the gate then blocks). Same gate as the other manual actions.

export async function POST(_req: NextRequest, { params }: { params: Promise<{ partnerId: string }> }) {
  const { partnerId } = await params
  const guard = await requirePlatformAdmin(partnerId)
  if (guard instanceof NextResponse) return guard
  const { ctx, partner } = guard

  let transitioned = false
  try {
    ;({ transitioned } = await expirePlatformGraceIfDue(partnerId, Date.now()))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await logAdminAction(ctx.email, {
      action: 'wl_platform_expire_grace_failed', targetType: 'partner', targetId: partnerId,
      targetLabel: partner.company_name, after: { error: message },
    })
    return NextResponse.json({ error: 'Grace sweep failed', detail: message }, { status: 502 })
  }

  await logAdminAction(ctx.email, {
    action: 'wl_platform_expire_grace', targetType: 'partner', targetId: partnerId,
    targetLabel: partner.company_name, after: { transitioned },
  })

  return NextResponse.json({ ok: true, partnerId, transitioned, at: new Date().toISOString() })
}

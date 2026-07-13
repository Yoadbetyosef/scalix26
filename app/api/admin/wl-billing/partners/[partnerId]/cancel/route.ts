import { NextRequest, NextResponse } from 'next/server'
import { logAdminAction } from '@/lib/admin/audit'
import { requirePlatformAdmin } from '@/lib/admin/platform-admin-guard'
import { cancelPlatformSubscription } from '@/lib/billing/platform-fee'

// POST /api/admin/wl-billing/partners/[partnerId]/cancel — cancel a partner's platform subscription.
//
// Partner churn / teardown: cancels the ONE Stripe subscription and records the terminal 'canceled' state
// (via the existing cancelPlatformSubscription → onPlatformSubscriptionCanceled, idempotent). No billing
// logic of its own beyond the single Stripe cancel. Same gate as the other manual actions: super-admin,
// rate-limited, Preview-only, partner must exist; only the path partnerId is trusted from the browser.

export async function POST(_req: NextRequest, { params }: { params: Promise<{ partnerId: string }> }) {
  const { partnerId } = await params
  const guard = await requirePlatformAdmin(partnerId)
  if (guard instanceof NextResponse) return guard
  const { ctx, partner } = guard

  let result: Awaited<ReturnType<typeof cancelPlatformSubscription>>
  try {
    result = await cancelPlatformSubscription(partnerId)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await logAdminAction(ctx.email, {
      action: 'wl_platform_cancel_failed', targetType: 'partner', targetId: partnerId,
      targetLabel: partner.company_name, after: { error: message },
    })
    return NextResponse.json({ error: 'Cancel failed', detail: message }, { status: 502 })
  }

  await logAdminAction(ctx.email, {
    action: 'wl_platform_cancel', targetType: 'partner', targetId: partnerId, targetLabel: partner.company_name,
    after: { canceled: result.canceled, subscriptionId: result.subscriptionId },
  })

  return NextResponse.json({ ok: true, partnerId, ...result, status: result.canceled ? 'canceled' : 'none', at: new Date().toISOString() })
}

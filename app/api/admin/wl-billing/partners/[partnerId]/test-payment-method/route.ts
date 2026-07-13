import { NextRequest, NextResponse } from 'next/server'
import { logAdminAction } from '@/lib/admin/audit'
import { requirePlatformAdmin } from '@/lib/admin/platform-admin-guard'
import { attachTestPaymentMethod, deleteTestCustomer, type TestCardScenario } from '@/lib/billing/platform-test-support'

// ⚠️ TEST-ONLY endpoint — remove before production promotion.
// POST /api/admin/wl-billing/partners/[partnerId]/test-payment-method  { scenario?: 'ok' | 'declined' }
//
// Attaches a Stripe TEST payment method to the partner's customer so the platform-subscription lifecycle
// is drivable on Preview. Same gate as the other admin actions (super-admin, rate-limited, Preview-only,
// partner must exist), the only browser input is the scenario enum (never a Stripe id), and the support
// function itself hard-refuses on a live Stripe key.

export async function POST(req: NextRequest, { params }: { params: Promise<{ partnerId: string }> }) {
  const { partnerId } = await params
  const guard = await requirePlatformAdmin(partnerId)
  if (guard instanceof NextResponse) return guard
  const { ctx, partner } = guard

  const body = await req.json().catch(() => ({}))
  const scenario: TestCardScenario = body?.scenario === 'declined' ? 'declined' : 'ok'

  try {
    const r = await attachTestPaymentMethod(partnerId, scenario)
    await logAdminAction(ctx.email, {
      action: 'wl_platform_test_pm', targetType: 'partner', targetId: partnerId,
      targetLabel: partner.company_name, after: { scenario, paymentMethod: r.paymentMethod },
    })
    return NextResponse.json({ ok: true, partnerId, ...r })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'Attach failed', detail: message }, { status: 502 })
  }
}

// DELETE — test teardown: delete the partner's Stripe TEST customer (cancels its subscriptions too).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ partnerId: string }> }) {
  const { partnerId } = await params
  const guard = await requirePlatformAdmin(partnerId)
  if (guard instanceof NextResponse) return guard
  const { ctx, partner } = guard
  try {
    const r = await deleteTestCustomer(partnerId)
    await logAdminAction(ctx.email, {
      action: 'wl_platform_test_pm_delete', targetType: 'partner', targetId: partnerId,
      targetLabel: partner.company_name, after: r,
    })
    return NextResponse.json({ ok: true, partnerId, ...r })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'Teardown failed', detail: message }, { status: 502 })
  }
}

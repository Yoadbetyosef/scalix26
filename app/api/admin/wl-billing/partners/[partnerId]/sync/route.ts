import { NextRequest, NextResponse } from 'next/server'
import { logAdminAction } from '@/lib/admin/audit'
import { requirePlatformAdmin } from '@/lib/admin/platform-admin-guard'
import { createAdminClient } from '@/lib/supabase/server'
import { syncPlatformQuantity, PLATFORM_PRICE_CENTS } from '@/lib/billing/platform-fee'
import { countActiveClients } from '@/lib/billing/platform-clients'

// POST /api/admin/wl-billing/partners/[partnerId]/sync — manual, SINGLE-partner platform-fee reconcile.
//
// The ONLY per-partner trigger for the $97/mo platform subscription; it exists so a partner can be
// reconciled/verified WITHOUT running the global cron (which sweeps every partner). No subscription/quantity
// logic of its own — it calls the existing engine syncPlatformQuantity(partnerId), which is idempotent
// (recompute-and-set). Security + Preview-gating are enforced by requirePlatformAdmin (super-admin only,
// rate-limited, Preview-only, partner-exists; the only trusted browser input is the path partnerId).

export async function POST(_req: NextRequest, { params }: { params: Promise<{ partnerId: string }> }) {
  const { partnerId } = await params
  const guard = await requirePlatformAdmin(partnerId)
  if (guard instanceof NextResponse) return guard
  const { ctx, partner } = guard

  let result: Awaited<ReturnType<typeof syncPlatformQuantity>>
  try {
    result = await syncPlatformQuantity(partnerId)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await logAdminAction(ctx.email, {
      action: 'wl_platform_sync_failed', targetType: 'partner', targetId: partnerId,
      targetLabel: partner.company_name, after: { error: message },
    })
    return NextResponse.json({ error: 'Sync failed', detail: message }, { status: 502 })
  }

  const [{ activeClients }, balRes] = await Promise.all([
    countActiveClients(partnerId),
    createAdminClient().from('partner_balances')
      .select('platform_active_qty, platform_fee_status, platform_subscription_id, platform_current_period_end, platform_grace_until')
      .eq('partner_id', partnerId).maybeSingle(),
  ])
  const bal = balRes.data
  const billedQuantity = Number(bal?.platform_active_qty ?? 0)

  await logAdminAction(ctx.email, {
    action: 'wl_platform_sync', targetType: 'partner', targetId: partnerId, targetLabel: partner.company_name,
    after: { action: result.action, quantity: result.quantity, status: bal?.platform_fee_status ?? 'none' },
  })

  return NextResponse.json({
    ok: true,
    partnerId,
    action: result.action,
    activeClients,
    billedQuantity,
    perClientCents: PLATFORM_PRICE_CENTS,
    monthlyTotalCents: billedQuantity * PLATFORM_PRICE_CENTS,
    status: bal?.platform_fee_status ?? 'none',
    hasSubscription: !!bal?.platform_subscription_id,
    nextInvoiceDate: bal?.platform_current_period_end ?? null,
    graceUntil: bal?.platform_grace_until ?? null,
    syncedAt: new Date().toISOString(),
  })
}

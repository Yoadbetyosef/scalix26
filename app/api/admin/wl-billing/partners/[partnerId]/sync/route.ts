import { NextRequest, NextResponse } from 'next/server'
import { getAdminContext, canManageSecurity } from '@/lib/admin/rbac'
import { logAdminAction } from '@/lib/admin/audit'
import { enforce } from '@/lib/ratelimit'
import { createAdminClient } from '@/lib/supabase/server'
import { syncPlatformQuantity, platformAdminSyncAllowed, PLATFORM_PRICE_CENTS } from '@/lib/billing/platform-fee'
import { countActiveClients } from '@/lib/billing/platform-clients'

// POST /api/admin/wl-billing/partners/[partnerId]/sync — manual, SINGLE-partner platform-fee reconcile.
//
// This is the ONLY per-partner trigger for the $97/mo platform subscription; it exists so a partner can
// be reconciled/verified WITHOUT running the global cron (which sweeps every partner). It does NOT contain
// any subscription/quantity logic of its own — it calls the existing engine syncPlatformQuantity(partnerId),
// which is idempotent (recompute-and-set) and safe to invoke repeatedly.
//
// Security: super-admin only; partner must exist; the ONLY input trusted from the browser is the partnerId
// in the path (never a Stripe customer/subscription id, quantity, price, or tenant id — all resolved
// server-side). Rate-limited per admin. Every attempt is written to the admin audit log.
//
// Environment: gated by platformAdminSyncAllowed() → enabled only when WL_PLATFORM_FEE_ENABLED=true AND the
// deployment is Preview (VERCEL_ENV=preview), so a production force-sync is never exposed by accident.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_req: NextRequest, { params }: { params: Promise<{ partnerId: string }> }) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canManageSecurity(ctx.role)) return NextResponse.json({ error: 'Super Admin only' }, { status: 403 })

  // Rate limit per admin (fail-closed policy).
  const flood = await enforce('admin_platform_sync', `platform_sync:${ctx.email}`)
  if (flood) return flood

  // Preview-only capability — never a production force-sync unless explicitly enabled later.
  if (!platformAdminSyncAllowed()) {
    return NextResponse.json({ error: 'Manual platform sync is not available in this environment' }, { status: 403 })
  }

  const { partnerId } = await params
  if (!UUID_RE.test(partnerId)) return NextResponse.json({ error: 'Invalid partner id' }, { status: 400 })

  const db = createAdminClient()
  const { data: partner } = await db.from('partners').select('id, company_name').eq('id', partnerId).maybeSingle()
  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

  // Reconcile through the existing engine — no duplicated Stripe/quantity logic here.
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

  // Read back the resolved, partner-safe state (server-side only — no provider economics).
  const [{ activeClients }, balRes] = await Promise.all([
    countActiveClients(partnerId),
    db.from('partner_balances')
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

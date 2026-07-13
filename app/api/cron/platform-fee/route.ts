import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { platformFeeEnabled, syncPlatformQuantity, expirePlatformGraceIfDue } from '@/lib/billing/platform-fee'

// WL PLATFORM subscription reconcile cron. Two idempotent sweeps, both INERT unless
// WL_PLATFORM_FEE_ENABLED=true and CRON_SECRET-authorized (fail-closed, Drop 2):
//   1) Dunning — past_due partners whose grace window has closed → payment_required (the gate blocks).
//   2) Quantity — for every partner that owns WL client tenants, set the subscription quantity to the
//      current active-client count (recompute-and-set → safe to run as often as you like).
// Schedule externally (cron-job.org) with the CRON_SECRET bearer, like /api/cron/billing.
async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!platformFeeEnabled()) return NextResponse.json({ ran: false, reason: 'disabled' })

  const db = createAdminClient()
  const now = Date.now()

  // 1) Grace expiry sweep.
  const { data: pastDue } = await db.from('partner_balances').select('partner_id').eq('platform_fee_status', 'past_due')
  let transitioned = 0
  for (const r of (pastDue || []) as Array<{ partner_id: string }>) {
    try { if ((await expirePlatformGraceIfDue(r.partner_id, now)).transitioned) transitioned++ } catch { /* per-partner best-effort */ }
  }

  // 2) Quantity reconcile for every partner that owns WL client tenants.
  const { data: owners } = await db.from('tenants').select('white_label_partner_id').not('white_label_partner_id', 'is', null)
  const partnerIds = [...new Set((owners || []).map((o: { white_label_partner_id: string }) => o.white_label_partner_id))]
  const actions: Record<string, number> = {}
  for (const pid of partnerIds) {
    try { const r = await syncPlatformQuantity(pid); actions[r.action] = (actions[r.action] || 0) + 1 } catch { actions.error = (actions.error || 0) + 1 }
  }

  return NextResponse.json({ ran: true, graceTransitioned: transitioned, partners: partnerIds.length, actions })
}

export const GET = handle
export const POST = handle

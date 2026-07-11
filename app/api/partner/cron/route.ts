import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { recomputeAllPartnerStats } from '@/lib/partner/stats'
import { autoApproveCommissions } from '@/lib/partner/commission'
import { autoPayoutRun } from '@/lib/partner/payout'
import { evaluateUpgrades } from '@/lib/partner/upgrades'
import { recomputeMarketingStats } from '@/lib/partner/marketing-stats'
import { cronAuthorized } from '@/lib/cron/auth'

export const maxDuration = 300

// Nightly Partner OS maintenance: auto-approve commissions, auto-pay connect-enabled partners,
// recompute stats/upgrades/marketing, and roll the click partition forward. Mirrors the brain cron auth.
//
// KILL-SWITCH (fail-closed): this job runs the money-movement path — autoApproveCommissions +
// autoPayoutRun (Stripe Connect transfers). It stays OFF until the commission + payout engine is
// validated with real partners in production. Set PARTNER_CRON_ENABLED=true to enable. Mirrors the
// LEARNING_CRON_ENABLED pattern. Unset / anything-but-'true' → the job is a no-op.
async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (process.env.PARTNER_CRON_ENABLED !== 'true') {
    return NextResponse.json({
      ok: true,
      ran: false,
      reason: 'partner_cron_disabled',
      message: 'Partner cron (auto-approve + auto-payout) is disabled until the commission/payout engine is validated with real partners. Set PARTNER_CRON_ENABLED=true to enable.',
    })
  }

  const approved = await autoApproveCommissions()
  // Auto-pay connect-enabled partners above the minimum threshold (hands-off once Stripe is on).
  const paidOut = await autoPayoutRun()
  const partners = await recomputeAllPartnerStats()
  // Nudge partners who crossed an upgrade threshold (after stats are fresh).
  const upgrades = await evaluateUpgrades()
  // Roll up Marketing OS performance (campaign/creative CAC/ROI caches).
  const marketing = await recomputeMarketingStats()

  // Roll the click partition forward (best-effort; the DEFAULT partition is the safety net).
  try {
    const db = createAdminClient()
    await db.rpc('ensure_referral_clicks_partition').then(() => {}, () => {})
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, partners, approved, paidOut, upgrades, marketing })
}

export const GET = handle
export const POST = handle

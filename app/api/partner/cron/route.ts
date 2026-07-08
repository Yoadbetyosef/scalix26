import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { recomputeAllPartnerStats } from '@/lib/partner/stats'
import { autoApproveCommissions } from '@/lib/partner/commission'
import { autoPayoutRun } from '@/lib/partner/payout'

export const maxDuration = 300

// Nightly Partner OS maintenance: recompute every partner's dashboard stats + health score, and
// ensure next month's referral_clicks partition exists. Mirrors the brain cron auth.
async function handle(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const cronOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  const vercelCron = !!req.headers.get('x-vercel-cron')
  const devOk = process.env.NODE_ENV !== 'production'
  if (!cronOk && !vercelCron && !devOk) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const approved = await autoApproveCommissions()
  // Auto-pay connect-enabled partners above the minimum threshold (hands-off once Stripe is on).
  const paidOut = await autoPayoutRun()
  const partners = await recomputeAllPartnerStats()

  // Roll the click partition forward (best-effort; the DEFAULT partition is the safety net).
  try {
    const db = createAdminClient()
    await db.rpc('ensure_referral_clicks_partition').then(() => {}, () => {})
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, partners, approved, paidOut })
}

export const GET = handle
export const POST = handle

import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron/auth'
import { runBillingCron } from '@/lib/billing/cron'

export const maxDuration = 60

// Near-real-time billing worker: prices unpriced White Label usage and debits partner balances
// through the balance-safe primitive (reload-before-pause; never negative). Gated by the shared
// CRON_SECRET (Drop 2) AND fail-closed behind WL_BILLING_ENABLED — a no-op until billing is switched
// on (after partners can fund + gating is live), so it is safe to ship ahead of those phases.
//
// SCHEDULING: the Vercel account is Hobby (daily crons only), so this runs on the EXTERNAL scheduler
// (cron-job.org) every 1-2 min with `Authorization: Bearer <CRON_SECRET>` — the same pattern as
// mailbox/poll + webhooks/email/process. Not in vercel.json.
async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const result = await runBillingCron()
  return NextResponse.json({ ok: true, ...result })
}

export const GET = handle
export const POST = handle

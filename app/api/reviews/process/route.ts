import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendReviewForAppointment, cronAuthorized } from '@/lib/reviews'

// Cron worker: find appointments due for a review request (3h+ after booking,
// not skipped, not already sent, tenant has a review URL + automation on) and
// send each one. GET (Vercel cron) + POST (cron-job.org) both supported.
async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = await createServiceClient()
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()

  // Tenants with automation on + a review URL.
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id')
    .eq('review_automation_enabled', true)
    .not('google_review_url', 'is', null)
  const tenantIds = (tenants || []).map((t) => t.id)
  if (tenantIds.length === 0) return NextResponse.json({ ok: true, sent: 0 })

  const { data: due } = await supabase
    .from('appointments')
    .select('id')
    .in('tenant_id', tenantIds)
    .in('status', ['confirmed', 'completed'])
    .is('review_sent_at', null)
    .or('skip_review.is.null,skip_review.eq.false')
    .lte('created_at', threeHoursAgo)
    .limit(200)

  let sent = 0, failed = 0
  for (const a of due || []) {
    const r = await sendReviewForAppointment(a.id)
    if (r.ok) sent++
    else failed++
  }

  return NextResponse.json({ ok: true, processed: due?.length || 0, sent, failed })
}

export const GET = handle
export const POST = handle

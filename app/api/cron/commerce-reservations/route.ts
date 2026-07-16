import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron/auth'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 120

// Nightly (or frequent) job: auto-release expired inventory reservations across all tenants via the
// expire_commerce_reservations() SECURITY DEFINER function (which releases each atomically + ledgers it).
// Fail-closed auth (CRON_SECRET bearer). Register in vercel.json crons or an external scheduler.
async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { data, error } = await createAdminClient().rpc('expire_commerce_reservations')
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, released: data ?? 0 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle

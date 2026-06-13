import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Records a handled voice call for dashboard metrics (Total Calls). The tenant
// is resolved from the secret lead-intake token (same pattern as
// /api/leads/inbound/<token>) so the endpoint can't be spoofed to inflate
// another tenant's numbers. Logged as message_handled + data.channel='voice'
// to match the existing pipeline analytics shape.
export async function POST(req: NextRequest) {
  const data = (await req.json().catch(() => ({}))) as { lead_token?: unknown; duration_seconds?: unknown }
  const leadToken = typeof data.lead_token === 'string' ? data.lead_token : undefined
  const durationSeconds = typeof data.duration_seconds === 'number' ? data.duration_seconds : null

  if (!leadToken) {
    return NextResponse.json({ error: 'lead_token required' }, { status: 400 })
  }

  const supabase = await createServiceClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('lead_intake_token', leadToken)
    .maybeSingle()

  if (!tenant) {
    return NextResponse.json({ error: 'invalid token' }, { status: 404 })
  }

  await supabase.from('analytics_events').insert({
    tenant_id: tenant.id,
    event_type: 'message_handled',
    data: { channel: 'voice', duration_seconds: durationSeconds },
  })

  return NextResponse.json({ ok: true })
}

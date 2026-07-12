import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyTwilio, shouldReject } from '@/lib/webhooks/verify'
import { enforce, clientIp } from '@/lib/ratelimit'
import { planVoiceMetering } from '@/lib/billing/voice-meter'
import { meterUsage } from '@/lib/billing/meter'

// Twilio call-status callback = the billing source of truth for VOICE. Fires at leg completion with
// CallSid, ParentCallSid, CallStatus, CallDuration, Direction, From, To. Signature is the primary
// gate (forged → 403, no metering). Only completed billable legs are metered, deterministically, off
// Twilio's CallDuration — Twilio telephony per leg + Deepgram voice-agent on the AI parent leg.
// Deduped by (provider, CallSid), so a duplicate callback never double-meters. Records only —
// charging stays gated by WL_BILLING_ENABLED.

const ok = () => new NextResponse('<?xml version="1.0"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
const e164 = (n?: string) => (!n ? undefined : n.startsWith('+') ? n : `+${n}`)

export async function POST(req: NextRequest) {
  const flood = await enforce('webhook', `twilio:${clientIp(req)}`)
  if (flood) return flood

  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body)) as Record<string, string>
  if (shouldReject(verifyTwilio(req, params))) {
    console.error('[voice-status] Twilio signature verification failed — rejecting.')
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Deepgram (voice-agent) streaming runs only when the voice server is configured (Path A).
  const plan = planVoiceMetering(params, { deepgramActive: !!process.env.VOICE_SERVER_WS_URL })
  if (plan.length === 0) return ok() // unanswered / failed / busy / zero-duration → not billable

  // Resolve the tenant from OUR Twilio number: parent leg → To; child dial leg → From.
  const db = createAdminClient()
  const nums = [e164(params.To), e164(params.From)].filter(Boolean) as string[]
  const { data: ch } = await db.from('channels').select('tenant_id')
    .in('twilio_number', nums).eq('type', 'voice').limit(1).maybeSingle()
  const tenantId = ch?.tenant_id as string | undefined
  if (!tenantId) { console.warn('[voice-status] no voice channel for', nums, '— skipping'); return ok() }

  // meterUsage resolves the owning WL partner + snapshots pricing; direct Scalix tenants meter with
  // partner_id NULL (tracked, never partner-billed). Deterministic dedup on (provider, CallSid).
  for (const item of plan) {
    meterUsage({
      tenantId, category: 'voice', provider: item.provider, metric: 'minute',
      quantity: item.quantity, providerCostUsd: item.providerCostUsd,
      resourceId: item.resourceId, kind: 'voice', metadata: item.metadata,
    })
  }
  return ok()
}

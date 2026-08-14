import twilio from 'twilio'
import { createAdminClient } from '@/lib/supabase/server'
import { primaryAgent } from '@/lib/agents/primary'
import { deriveAreaCode, stateToAbbr } from '@/lib/twilio/area-code'

// `partnerTwilio` routes provisioning through a White Label partner's OWN Twilio account (they pay
// the provider directly). When omitted, falls back to the platform env — fully backward compatible.
export async function provisionAgentPhoneNumber(
  tenantId: string,
  agentId: string,
  partnerTwilio?: { accountSid: string; authToken: string; messagingServiceSid?: string },
): Promise<string | null> {
  // Admin (true service-role) client: createServiceClient is cookie-based and, when a WL partner is
  // operating a client workspace, downgrades to the partner's JWT under RLS — the channel insert would
  // then fail (no RLS insert policy for a non-owned tenant). Scoped entirely by the validated tenantId/agentId args.
  const supabase = createAdminClient()

  // Idempotent: return existing number if this agent already has one
  const { data: existing } = await supabase
    .from('channels')
    .select('twilio_number')
    .eq('ai_employee_id', agentId)
    .eq('type', 'sms')
    .not('twilio_number', 'is', null)
    .maybeSingle()

  if (existing?.twilio_number) return existing.twilio_number

  const client = partnerTwilio
    ? twilio(partnerTwilio.accountSid, partnerTwilio.authToken)
    : twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!

  // Region-aware, progressive number search so a new number matches the customer's
  // area — never random. Region is read from the freshly-saved agent/tenant rows; any
  // missing field just skips its step. deriveAreaCode (phone → preferred) drives step 2.
  let zip: string | null = null
  let state: string | null = null
  let areaCode: number | undefined
  try {
    const [{ data: agent }, { data: tenant }] = await Promise.all([
      supabase.from('ai_employees').select('forward_to_phone, state, zip').eq('id', agentId).maybeSingle(),
      supabase.from('tenants').select('phone, state, zip').eq('id', tenantId).maybeSingle(),
    ])
    zip = (agent?.zip || tenant?.zip || '').trim() || null
    state = agent?.state || tenant?.state || null
    const derived = deriveAreaCode({
      forwardPhone: agent?.forward_to_phone,
      tenantPhone: tenant?.phone,
      state,
    })
    if (derived) areaCode = parseInt(derived, 10)
  } catch (err) {
    console.error('[provision] region lookup failed — using any-local:', err instanceof Error ? err.message : err)
  }

  type LocalOpts = { areaCode?: number; inPostalCode?: string; inRegion?: string }
  const baseOpts = { smsEnabled: true, voiceEnabled: true, limit: 5 }
  let available: { phoneNumber: string }[] = []
  let matchedBy: 'zip' | 'areaCode' | 'state' | 'any' = 'any'

  // Run a search step only if nothing matched yet; guarded so it never throws and
  // provisioning never aborts on a single step's error.
  const trySearch = async (by: 'zip' | 'areaCode' | 'state' | 'any', opts: LocalOpts) => {
    if (available.length) return
    try {
      const res = await client.availablePhoneNumbers('US').local.list({ ...baseOpts, ...opts })
      if (res.length) { available = res; matchedBy = by }
    } catch (err) {
      console.error(`[provision] search by ${by} failed:`, err instanceof Error ? err.message : err)
    }
  }

  // 1) ZIP (most precise) → 2) area code (phone-derived) → 3) state → 4) any US local.
  if (zip) await trySearch('zip', { inPostalCode: zip })
  if (areaCode) await trySearch('areaCode', { areaCode })
  const region = stateToAbbr(state)
  if (region) await trySearch('state', { inRegion: region })
  await trySearch('any', {})

  if (!available.length) return null
  console.log(`[provision] ${tenantId} -> matched by ${matchedBy}`)

  const number = await client.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
    smsUrl: `${baseUrl}/api/webhooks/twilio/sms`,
    smsMethod: 'POST',
    voiceUrl: `${baseUrl}/api/webhooks/twilio/voice`,
    voiceMethod: 'POST',
    // Call-status callback = the billing source of truth for voice (fires at call completion with
    // CallSid + CallDuration + CallStatus). Existing numbers need a one-time backfill of this URL.
    statusCallback: `${baseUrl}/api/webhooks/twilio/voice/status`,
    statusCallbackMethod: 'POST',
  })

  // A2P 10DLC: attach the freshly purchased US number to our approved Messaging
  // Service. Per Twilio, adding a number to a service whose campaign is approved
  // AUTO-REGISTERS it to that campaign — no separate registration call — so the
  // number's outbound SMS isn't rejected with Error 30034 "Message from an
  // Unregistered Number". FAIL-SAFE + NON-BLOCKING: any failure here only logs;
  // the customer still keeps their number and voice still works. IDEMPOTENT:
  // Twilio code 21710 ("already exists in Messaging Service") is treated as success.
  const messagingServiceSid = partnerTwilio?.messagingServiceSid || process.env.TWILIO_MESSAGING_SERVICE_SID
  if (messagingServiceSid) {
    try {
      await client.messaging.v1.services(messagingServiceSid)
        .phoneNumbers.create({ phoneNumberSid: number.sid })
      console.log(`[provision] attached ${number.phoneNumber} (${number.sid}) to Messaging Service ${messagingServiceSid} for tenant ${tenantId} — A2P-registered`)
    } catch (err) {
      const code = (err as { code?: number })?.code
      if (code === 21710) {
        console.log(`[provision] ${number.phoneNumber} already in Messaging Service ${messagingServiceSid} (tenant ${tenantId}) — ok`)
      } else {
        console.error(`[provision] FAILED to attach ${number.phoneNumber} (${number.sid}) to Messaging Service ${messagingServiceSid} for tenant ${tenantId} — SMS may hit 30034 until attached; retry manually:`, err instanceof Error ? err.message : err)
      }
    }
  } else {
    console.error(`[provision] TWILIO_MESSAGING_SERVICE_SID not set — ${number.phoneNumber} NOT attached to any Messaging Service (tenant ${tenantId}); outbound SMS may hit 30034`)
  }

  await supabase.from('channels').insert([
    {
      tenant_id: tenantId,
      ai_employee_id: agentId,
      type: 'sms',
      twilio_number: number.phoneNumber,
      status: 'connected',
      credentials: { sid: number.sid },
    },
    {
      tenant_id: tenantId,
      ai_employee_id: agentId,
      type: 'voice',
      twilio_number: number.phoneNumber,
      status: 'connected',
      credentials: { sid: number.sid },
    },
  ])

  return number.phoneNumber
}

// Legacy alias kept for any remaining callers
export async function provisionTenantPhoneNumber(tenantId: string): Promise<string | null> {
  const supabase = createAdminClient()

  // NOT in the original mapping, and the most expensive instance of the fault: this runs from the
  // Stripe checkout webhook. Unbounded maybeSingle() + a second active employee = null agent = the
  // tenant pays for a plan and never gets a number, with a caught-and-logged error as the only trace.
  const agent = await primaryAgent<{ id: string }>(supabase, tenantId, 'id')

  if (!agent) return null
  return provisionAgentPhoneNumber(tenantId, agent.id)
}

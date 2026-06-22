import twilio from 'twilio'
import { createServiceClient } from '@/lib/supabase/server'
import { deriveAreaCode } from '@/lib/twilio/area-code'

export async function provisionAgentPhoneNumber(tenantId: string, agentId: string): Promise<string | null> {
  const supabase = await createServiceClient()

  // Idempotent: return existing number if this agent already has one
  const { data: existing } = await supabase
    .from('channels')
    .select('twilio_number')
    .eq('ai_employee_id', agentId)
    .eq('type', 'sms')
    .not('twilio_number', 'is', null)
    .maybeSingle()

  if (existing?.twilio_number) return existing.twilio_number

  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!

  // Derive a local area code matching the customer's region (fail-safe). Reads the
  // business phone (forward_to_phone → tenant.phone), then state. Any failure leaves
  // areaCode undefined → identical to today's any-local search.
  let areaCode: number | undefined
  try {
    const [{ data: agent }, { data: tenant }] = await Promise.all([
      supabase.from('ai_employees').select('forward_to_phone, state').eq('id', agentId).maybeSingle(),
      supabase.from('tenants').select('phone, state').eq('id', tenantId).maybeSingle(),
    ])
    const derived = deriveAreaCode({
      forwardPhone: agent?.forward_to_phone,
      tenantPhone: tenant?.phone,
      state: agent?.state || tenant?.state,
    })
    if (derived) areaCode = parseInt(derived, 10)
  } catch (err) {
    console.error('[provision] area-code derivation failed — using any-local:', err instanceof Error ? err.message : err)
  }

  const baseOpts = { smsEnabled: true, voiceEnabled: true, limit: 5 }
  let available: { phoneNumber: string }[] = []

  // Prefer the derived area code; on empty/error fall back to any US local so
  // provisioning NEVER fails just because that area code has no inventory.
  if (areaCode) {
    try {
      available = await client.availablePhoneNumbers('US').local.list({ ...baseOpts, areaCode })
    } catch (err) {
      console.error(`[provision] area-code ${areaCode} search failed — falling back to any-local:`, err instanceof Error ? err.message : err)
    }
    if (!available.length) {
      console.log(`[provision] no numbers in area code ${areaCode} — falling back to any-local`)
    }
  }
  if (!available.length) {
    available = await client.availablePhoneNumbers('US').local.list(baseOpts)
  }

  if (!available.length) return null

  const number = await client.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
    smsUrl: `${baseUrl}/api/webhooks/twilio/sms`,
    smsMethod: 'POST',
    voiceUrl: `${baseUrl}/api/webhooks/twilio/voice`,
    voiceMethod: 'POST',
  })

  // A2P 10DLC: attach the freshly purchased US number to our approved Messaging
  // Service. Per Twilio, adding a number to a service whose campaign is approved
  // AUTO-REGISTERS it to that campaign — no separate registration call — so the
  // number's outbound SMS isn't rejected with Error 30034 "Message from an
  // Unregistered Number". FAIL-SAFE + NON-BLOCKING: any failure here only logs;
  // the customer still keeps their number and voice still works. IDEMPOTENT:
  // Twilio code 21710 ("already exists in Messaging Service") is treated as success.
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
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
  const supabase = await createServiceClient()

  const { data: agent } = await supabase
    .from('ai_employees')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle()

  if (!agent) return null
  return provisionAgentPhoneNumber(tenantId, agent.id)
}

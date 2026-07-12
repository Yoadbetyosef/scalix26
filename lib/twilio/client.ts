import twilio from 'twilio'
import { stripMarkdown } from '@/lib/utils'
import { createAdminClient } from '@/lib/supabase/server'
import { meterUsage } from '@/lib/billing/meter'
import { RATE_TWILIO_SMS_PER_SEGMENT } from '@/lib/cost/rates'

// Optional billing context — when a tenant is in scope, the send is metered (message SID = the
// deterministic resource id, Twilio's num_segments = the quantity).
export interface SendMeta { tenantId?: string; customerId?: string | null }

function getTwilioClient() {
  return twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
  )
}

// A3 feature flag: route A2P-active numbers through their Messaging Service.
// Defaults OFF → exact current behavior (raw `from`). Even when ON, only channels
// explicitly marked sms_status='active' WITH a messaging_service_sid are routed;
// every other number stays raw, so test tenants are unaffected.
const MG_SEND_ENABLED = process.env.SMS_VIA_MESSAGING_SERVICE === 'true'

// Look up the sending channel's A2P routing config by its number. Fail-safe:
// returns null on any error so the caller falls back to raw `from`.
async function getSmsRouting(from: string): Promise<{ messagingServiceSid: string } | null> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('channels')
      .select('sms_status, messaging_service_sid')
      .eq('twilio_number', from)
      .eq('type', 'sms')
      .maybeSingle()
    if (data?.sms_status === 'active' && data.messaging_service_sid) {
      return { messagingServiceSid: data.messaging_service_sid }
    }
    return null
  } catch {
    return null
  }
}

export async function provisionPhoneNumber(areaCode?: string): Promise<string> {
  const client = getTwilioClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID!

  // Search for an available local US number
  let available: { phoneNumber: string }[] = []
  if (areaCode) {
    const res = await client.availablePhoneNumbers('US').local.list({ areaCode: parseInt(areaCode), limit: 1 })
    available = res
  }
  if (!available.length) {
    available = await client.availablePhoneNumbers('US').local.list({ limit: 1 })
  }
  if (!available.length) throw new Error('No available phone numbers')

  // Purchase the number with voice webhook configured
  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
    voiceUrl: `${appUrl}/api/webhooks/twilio/voice`,
    voiceMethod: 'POST',
    smsUrl: `${appUrl}/api/webhooks/twilio/sms`,
    smsMethod: 'POST',
  })

  // Add to Messaging Service for A2P SMS compliance
  if (messagingServiceSid) {
    await client.messaging.v1.services(messagingServiceSid)
      .phoneNumbers
      .create({ phoneNumberSid: purchased.sid })
  }

  return purchased.phoneNumber
}

export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    url,
    params
  )
}

export async function sendSMS(to: string, body: string, from?: string, meta?: SendMeta) {
  const client = getTwilioClient()

  // WhatsApp must stay on the from-based path (the Messaging Service is SMS/MMS
  // A2P only). Detect it from either side of the send.
  const isWhatsApp = to.startsWith('whatsapp:') || (from?.startsWith('whatsapp:') ?? false)
  const MSID = process.env.TWILIO_MESSAGING_SERVICE_SID

  const params: Parameters<typeof client.messages.create>[0] = {
    to,
    // Plain-text channels (SMS + WhatsApp) — guarantee no markdown ships.
    body: stripMarkdown(body),
  }

  // A2: always attach a delivery statusCallback so undelivered/30034 is recorded
  // (additive — has no effect on whether/how the message sends).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) params.statusCallback = `${appUrl}/api/webhooks/twilio/sms-status`

  // Default A2P path: route plain SMS/MMS through the approved Messaging Service via
  // env, so every number sends under the approved 10DLC campaign (no Error 30034).
  // When we have the tenant's own number, pass `from` TOO — Twilio supports both
  // together and will send from THAT specific sender in the pool, preserving
  // per-tenant identity (without it the pool auto-picks any verified number). The
  // `from` must be in the service's Sender Pool; our provisioned numbers are
  // auto-attached on provision. Only when we have no `from` (e.g. admin/test) do we
  // let the service pick.
  if (!isWhatsApp && MSID) {
    params.messagingServiceSid = MSID
    if (from) params.from = from
  } else {
    // WhatsApp, OR no MSID configured (safety fallback so non-prod envs still send):
    // keep the original from-based behavior.
    params.from = from || process.env.TWILIO_PHONE_NUMBER!
    if (!isWhatsApp && !MSID) {
      console.warn('[sendSMS] TWILIO_MESSAGING_SERVICE_SID not set — sending with bare `from`; outbound may hit Error 30034 until the env var is configured')
    }
  }

  // Confirm per-tenant identity in logs: which sender + which service each send used.
  console.log(`[sendSMS] from=${params.from ?? '(pool-selected)'} service=${params.messagingServiceSid ?? '(none)'}${isWhatsApp ? ' channel=whatsapp' : ''}`)

  const msg = await client.messages.create(params)
  // Meter the send (deterministic: message SID + Twilio's num_segments). Only when a tenant is known.
  if (meta?.tenantId && msg?.sid) {
    const segments = Math.max(1, parseInt(String(msg.numSegments || '1'), 10) || 1)
    meterUsage({
      tenantId: meta.tenantId, customerId: meta.customerId ?? null,
      category: 'messaging', provider: 'twilio', metric: 'sms_segment',
      quantity: segments, providerCostUsd: segments * RATE_TWILIO_SMS_PER_SEGMENT,
      resourceId: msg.sid, kind: isWhatsApp ? 'whatsapp' : 'sms',
    })
  }
  return msg
}

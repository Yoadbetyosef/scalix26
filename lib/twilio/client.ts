import twilio from 'twilio'
import { stripMarkdown } from '@/lib/utils'
import { createAdminClient } from '@/lib/supabase/server'

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

export async function sendSMS(to: string, body: string, from?: string) {
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
  // Twilio requires EXACTLY ONE of messagingServiceSid / from — so we OMIT `from`
  // here. The service's Sender Pool picks the customer's own number as the sender.
  if (!isWhatsApp && MSID) {
    params.messagingServiceSid = MSID
  } else {
    // WhatsApp, OR no MSID configured (safety fallback so non-prod envs still send):
    // keep the original from-based behavior.
    params.from = from || process.env.TWILIO_PHONE_NUMBER!
    if (!isWhatsApp && !MSID) {
      console.warn('[sendSMS] TWILIO_MESSAGING_SERVICE_SID not set — sending with bare `from`; outbound may hit Error 30034 until the env var is configured')
    }
  }

  return client.messages.create(params)
}

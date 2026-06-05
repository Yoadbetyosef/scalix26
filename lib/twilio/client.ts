import twilio from 'twilio'

function getTwilioClient() {
  return twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
  )
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
  return client.messages.create({
    to,
    from: from || process.env.TWILIO_PHONE_NUMBER!,
    body,
  })
}

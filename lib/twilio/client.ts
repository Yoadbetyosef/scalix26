import twilio from 'twilio'

function getTwilioClient() {
  return twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
  )
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

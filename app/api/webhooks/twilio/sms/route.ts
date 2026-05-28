import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createServiceClient } from '@/lib/supabase/server'
import { runAIPipeline } from '@/lib/anthropic/pipeline'
import { sendSMS } from '@/lib/twilio/client'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))

  // Validate Twilio signature
  const signature = req.headers.get('x-twilio-signature') || ''
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/sms`

  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    url,
    params
  )

  if (!valid && process.env.NODE_ENV === 'production') {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const { From, To, Body } = params

  // Find tenant by Twilio number
  const supabase = await createServiceClient()
  const { data: channel } = await supabase
    .from('channels')
    .select('tenant_id')
    .eq('twilio_number', To)
    .eq('type', 'sms')
    .single()

  if (!channel) {
    return new NextResponse('<?xml version="1.0"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  try {
    const result = await runAIPipeline({
      tenantId: channel.tenant_id,
      channelType: 'sms',
      from: From,
      messageContent: Body,
    })

    // Send SMS response
    await sendSMS(From, result.response, To)
  } catch (err) {
    console.error('SMS pipeline error:', err)
  }

  return new NextResponse('<?xml version="1.0"?><Response></Response>', {
    headers: { 'Content-Type': 'text/xml' },
  })
}

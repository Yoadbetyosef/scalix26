import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runAIPipeline } from '@/lib/anthropic/pipeline'
import { sendSMS } from '@/lib/twilio/client'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))
  const { From, To, Body } = params

  // WhatsApp numbers come as "whatsapp:+1234567890"
  const fromNumber = From.replace('whatsapp:', '')
  const toNumber = To.replace('whatsapp:', '')

  const supabase = await createServiceClient()
  const { data: channel } = await supabase
    .from('channels')
    .select('tenant_id')
    .eq('twilio_number', toNumber)
    .eq('type', 'whatsapp')
    .single()

  if (!channel) {
    return new NextResponse('<?xml version="1.0"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  try {
    const result = await runAIPipeline({
      tenantId: channel.tenant_id,
      channelType: 'whatsapp',
      from: fromNumber,
      messageContent: Body,
    })

    await sendSMS(`whatsapp:${fromNumber}`, result.response, `whatsapp:${toNumber}`)
  } catch (err) {
    console.error('WhatsApp pipeline error:', err)
  }

  return new NextResponse('<?xml version="1.0"?><Response></Response>', {
    headers: { 'Content-Type': 'text/xml' },
  })
}

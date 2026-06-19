import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createServiceClient } from '@/lib/supabase/server'
import { runAIPipeline } from '@/lib/anthropic/pipeline'
import { sendSMS } from '@/lib/twilio/client'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))

  // Validate Twilio signature using the actual incoming host
  const signature = req.headers.get('x-twilio-signature') || ''
  const host = req.headers.get('host') || ''
  const protocol = host.includes('localhost') ? 'http' : 'https'
  const url = `${protocol}://${host}/api/webhooks/twilio/sms`

  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    url,
    params
  )

  console.log('[SMS] Signature valid:', valid, '| URL used:', url)

  if (!valid && process.env.NODE_ENV === 'production') {
    console.error('[SMS] Signature validation failed. URL:', url)
    return new NextResponse('Forbidden', { status: 403 })
  }

  const { From, To, Body } = params

  // Find agent by Twilio number
  const supabase = await createServiceClient()
  const { data: channel } = await supabase
    .from('channels')
    .select('tenant_id, ai_employee_id')
    .eq('twilio_number', To)
    .eq('type', 'sms')
    .single()

  if (!channel) {
    return new NextResponse('<?xml version="1.0"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  // STOP → opt the sender out of any active drip campaigns (don't run the AI).
  if ((Body || '').trim().toLowerCase() === 'stop') {
    await supabase
      .from('drip_campaigns')
      .update({ status: 'stopped', updated_at: new Date().toISOString() })
      .eq('tenant_id', channel.tenant_id)
      .eq('contact_phone', From)
      .eq('status', 'active')
    console.log('[SMS] STOP — drip campaigns stopped for', From)
    return new NextResponse('<?xml version="1.0"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  try {
    const result = await runAIPipeline({
      tenantId: channel.tenant_id,
      agentId: channel.ai_employee_id ?? undefined,
      channelType: 'sms',
      from: From,
      messageContent: Body,
    })

    // Send SMS response (unless a human has taken over this conversation)
    if (!result.skipped && result.response) {
      try {
        const msg = await sendSMS(From, result.response, To)
        console.log('[SMS] Sent successfully. SID:', msg.sid)
        // A2: link the Twilio SID to the assistant message runAIPipeline just wrote,
        // so the sms-status callback can flip its delivery_status. Best-effort.
        try {
          const { data: last } = await supabase
            .from('messages')
            .select('id')
            .eq('conversation_id', result.conversationId)
            .eq('role', 'assistant')
            .order('timestamp', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (last) {
            await supabase.from('messages')
              .update({ provider_sid: msg.sid, delivery_status: msg.status })
              .eq('id', last.id)
          }
        } catch (linkErr: any) {
          console.error('[SMS] provider_sid link failed:', linkErr?.message)
        }
      } catch (smsErr: any) {
        console.error('[SMS] sendSMS failed:', smsErr?.message, smsErr?.code, smsErr?.status)
      }
    }
  } catch (err: any) {
    console.error('[SMS] Pipeline error:', err?.message)
  }

  return new NextResponse('<?xml version="1.0"?><Response></Response>', {
    headers: { 'Content-Type': 'text/xml' },
  })
}

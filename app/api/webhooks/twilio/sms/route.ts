import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runAIPipeline } from '@/lib/anthropic/pipeline'
import { sendSMS } from '@/lib/twilio/client'
import { verifyTwilio, shouldReject } from '@/lib/webhooks/verify'
import { claimEvent, completeEvent, failEvent, fingerprint } from '@/lib/webhooks/idempotency'
import { enforce, clientIp } from '@/lib/ratelimit'

const emptyTwiml = () => new NextResponse('<?xml version="1.0"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } })

export async function POST(req: NextRequest) {
  // Flood cap BEFORE signature crypto (signature stays primary). Generous → provider retries pass.
  const flood = await enforce('webhook', `twilio:${clientIp(req)}`)
  if (flood) return flood
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))

  // Signature verification is the primary security layer — a forged request is never processed.
  if (shouldReject(verifyTwilio(req, params))) {
    console.error('[SMS] Twilio signature verification failed — rejecting.')
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

  // Idempotency: a Twilio retry of the SAME message must not produce a second AI reply / outbound SMS.
  const claim = await claimEvent('twilio', params.MessageSid || fingerprint('sms', From, To, Body), 'sms', channel.tenant_id)
  if (claim.unavailable) return new NextResponse('Service Unavailable', { status: 503 }) // fail-closed: no replay protection → don't process
  if (claim.duplicate) { console.log('[SMS] duplicate delivery — skipping', params.MessageSid); return emptyTwiml() }

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
    await completeEvent(claim, channel.tenant_id)
  } catch (err: any) {
    console.error('[SMS] Pipeline error:', err?.message)
    await failEvent(claim) // retryable — never permanently suppress a failed event
  }

  return emptyTwiml()
}

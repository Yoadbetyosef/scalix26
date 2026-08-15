import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runAIPipeline } from '@/lib/anthropic/pipeline'
import { maybeHold } from '@/lib/miles/intercept'
import { sendSMS } from '@/lib/twilio/client'
import { verifyTwilio, shouldReject } from '@/lib/webhooks/verify'
import { claimEvent, completeEvent, failEvent, fingerprint } from '@/lib/webhooks/idempotency'
import { enforce, clientIp } from '@/lib/ratelimit'
import { stopDripsForPhone } from '@/lib/leads/drip'

const emptyTwiml = () => new NextResponse('<?xml version="1.0"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } })

export async function POST(req: NextRequest) {
  const flood = await enforce('webhook', `twilio:${clientIp(req)}`)
  if (flood) return flood
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))

  // Signature verification is the primary security layer — a forged message is never processed.
  if (shouldReject(verifyTwilio(req, params))) {
    console.error('[whatsapp] Twilio signature verification failed — rejecting.')
    return new NextResponse('Forbidden', { status: 403 })
  }

  const { From, To, Body } = params

  // WhatsApp numbers come as "whatsapp:+1234567890"
  const fromNumber = From.replace('whatsapp:', '')
  const toNumber = To.replace('whatsapp:', '')

  const supabase = await createServiceClient()
  const { data: channel } = await supabase
    .from('channels')
    // ai_employee_id so the autonomy rule can tell whether the messages employee owns this number.
    .select('tenant_id, ai_employee_id')
    .eq('twilio_number', toNumber)
    .eq('type', 'whatsapp')
    .single()

  if (!channel) return emptyTwiml()

  // Answering ends the follow-up sequence — same brake, same helper, one line. The drip is an SMS
  // sequence to a phone number, and this IS that number writing back.
  await stopDripsForPhone(supabase, channel.tenant_id, fromNumber, `inbound whatsapp from ${fromNumber}`)

  // Idempotency: a Twilio retry must not produce a second AI reply.
  const claim = await claimEvent('twilio', params.MessageSid || fingerprint('whatsapp', From, To, Body), 'whatsapp', channel.tenant_id)
  if (claim.unavailable) return new NextResponse('Service Unavailable', { status: 503 }) // fail-closed
  if (claim.duplicate) { console.log('[whatsapp] duplicate delivery — skipping', params.MessageSid); return emptyTwiml() }

  try {
    const result = await runAIPipeline({
      tenantId: channel.tenant_id,
      channelType: 'whatsapp',
      from: fromNumber,
      messageContent: Body,
    })

    // Skip the AI reply when a human has taken over, or when Miles is holding it for a decision.
    const held = !result.skipped && result.response
      ? await maybeHold({
          db: supabase, tenantId: channel.tenant_id, agentId: channel.ai_employee_id,
          conversationId: result.conversationId, channel: 'whatsapp', inbound: Body, reply: result.response,
        })
      : { held: false }
    if (!result.skipped && result.response && !held.held) {
      await sendSMS(`whatsapp:${fromNumber}`, result.response, `whatsapp:${toNumber}`, { tenantId: channel.tenant_id })
    }
    await completeEvent(claim, channel.tenant_id)
  } catch (err) {
    console.error('WhatsApp pipeline error:', err)
    await failEvent(claim)
  }

  return emptyTwiml()
}

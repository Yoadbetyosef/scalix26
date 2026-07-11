import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runAIPipeline } from '@/lib/anthropic/pipeline'
import { transcribeAudioUrl } from '@/lib/deepgram/transcribe'
import { verifyMetaSignature, shouldReject } from '@/lib/webhooks/verify'
import { claimEvent, completeEvent, fingerprint, type Claim } from '@/lib/webhooks/idempotency'

// The inbound customer text — from a normal text message, or (voice notes) transcribed from
// an audio attachment via Deepgram. Returns '' when there's nothing we can act on.
async function inboundText(messaging: { message?: { text?: string; attachments?: { type?: string; payload?: { url?: string } }[] } }): Promise<string> {
  const msg = messaging.message
  if (msg?.text) return msg.text
  const audio = (msg?.attachments || []).find((a) => a?.type === 'audio' && a?.payload?.url)
  if (audio?.payload?.url) return await transcribeAudioUrl(audio.payload.url)
  return ''
}

// Meta webhook verification (used for both Instagram and Facebook)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

async function sendInstagramReply(recipientId: string, text: string, accessToken: string) {
  const token = accessToken || process.env.META_PAGE_ACCESS_TOKEN || ''
  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      access_token: token,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('Instagram reply error:', res.status, err)
  }
}

async function sendFacebookReply(recipientId: string, text: string, accessToken: string) {
  const token = accessToken || process.env.META_PAGE_ACCESS_TOKEN || ''
  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('Meta Graph API error (Facebook):', res.status, err)
  }
}

export async function POST(req: NextRequest) {
  // Verify X-Hub-Signature-256 over the RAW body (never re-serialize) before parsing — a forged Meta
  // event is never processed or persisted. Signature verification is the primary security layer.
  const raw = await req.text()
  if (shouldReject(verifyMetaSignature(raw, req.headers.get('x-hub-signature-256')))) {
    console.error('[meta] X-Hub-Signature-256 verification failed — rejecting.')
    return new NextResponse('Forbidden', { status: 403 })
  }
  const body = JSON.parse(raw || '{}')

  // Idempotency: Meta re-delivers byte-identical payloads on retry. Fingerprint the raw body so a retry
  // never re-processes (no duplicate AI reply / outbound message).
  const claim: Claim = await claimEvent('meta', fingerprint('meta', raw), body.object || 'meta', null)
  if (claim.unavailable) return new NextResponse('Service Unavailable', { status: 503 }) // fail-closed
  if (claim.duplicate) { console.log('[meta] duplicate delivery — skipping'); return NextResponse.json({ status: 'duplicate' }) }

  const supabase = await createServiceClient()

  // Instagram DMs
  if (body.object === 'instagram') {
    for (const entry of body.entry || []) {
      // Support both old format (entry.messaging) and new Instagram API format (entry.changes)
      const messagingEvents = entry.messaging || (entry.changes || [])
        .filter((c: { field: string }) => c.field === 'messages')
        .map((c: { value: unknown }) => c.value)

      for (const messaging of messagingEvents) {
        const text = await inboundText(messaging)
        if (!text) continue

        const senderId = messaging.sender.id
        const recipientId = messaging.recipient.id

        const { data: channels } = await supabase
          .from('channels')
          .select('tenant_id, ai_employee_id, credentials')
          .eq('meta_page_id', recipientId)
          .eq('type', 'instagram')
          .eq('status', 'connected')
          .not('ai_employee_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)

        const channel = channels?.[0]
        if (!channel) {
          console.error('Instagram: no channel found for meta_page_id', recipientId)
          continue
        }

        const result = await runAIPipeline({
          tenantId: channel.tenant_id,
          agentId: channel.ai_employee_id ?? undefined,
          channelType: 'instagram',
          from: senderId,
          messageContent: text,
        })

        if (!result.skipped && result.response) {
          const accessToken = (channel.credentials as Record<string, string>)?.access_token || ''
          await sendInstagramReply(senderId, result.response, accessToken)
        }
      }
    }
    await completeEvent(claim)
    return NextResponse.json({ status: 'ok' })
  }

  // Facebook Messenger
  if (body.object === 'page') {
    for (const entry of body.entry || []) {
      const pageId = entry.id
      for (const messaging of entry.messaging || []) {
        if (messaging.sender.id === pageId) continue
        const text = await inboundText(messaging)
        if (!text) continue

        const senderId = messaging.sender.id

        const { data: channels } = await supabase
          .from('channels')
          .select('tenant_id, ai_employee_id, credentials')
          .eq('meta_page_id', pageId)
          .eq('type', 'facebook')
          .eq('status', 'connected')
          .not('ai_employee_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)

        const channel = channels?.[0]
        if (!channel) {
          console.error('Facebook: no channel found for meta_page_id', pageId)
          continue
        }

        const result = await runAIPipeline({
          tenantId: channel.tenant_id,
          agentId: channel.ai_employee_id ?? undefined,
          channelType: 'facebook',
          from: senderId,
          messageContent: text,
        })

        if (!result.skipped && result.response) {
          const accessToken = (channel.credentials as Record<string, string>)?.access_token || ''
          await sendFacebookReply(senderId, result.response, accessToken)
        }
      }
    }
    await completeEvent(claim)
    return NextResponse.json({ status: 'ok' })
  }

  await completeEvent(claim)
  return NextResponse.json({ status: 'ignored' })
}

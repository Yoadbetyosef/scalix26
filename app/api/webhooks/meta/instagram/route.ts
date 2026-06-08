import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runAIPipeline } from '@/lib/anthropic/pipeline'

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

async function sendInstagramReply(recipientId: string, text: string) {
  const token = process.env.META_INSTAGRAM_ACCESS_TOKEN || ''
  const res = await fetch(`https://graph.instagram.com/v21.0/me/messages`, {
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
    console.error('Meta Graph API error:', res.status, err)
  }
}

async function sendFacebookReply(recipientId: string, text: string) {
  const token = process.env.META_PAGE_ACCESS_TOKEN || ''
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
  const body = await req.json()
  const supabase = await createServiceClient()

  // Instagram DMs
  if (body.object === 'instagram') {
    for (const entry of body.entry || []) {
      for (const messaging of entry.messaging || []) {
        if (!messaging.message?.text) continue

        const senderId = messaging.sender.id
        const recipientId = messaging.recipient.id
        const text = messaging.message.text

        const { data: channel } = await supabase
          .from('channels')
          .select('tenant_id')
          .eq('meta_page_id', recipientId)
          .eq('type', 'instagram')
          .single()

        if (!channel) {
          console.error('Instagram: no channel found for meta_page_id', recipientId)
          continue
        }

        const result = await runAIPipeline({
          tenantId: channel.tenant_id,
          channelType: 'instagram',
          from: senderId,
          messageContent: text,
        })

        await sendInstagramReply(senderId, result.response)
      }
    }
    return NextResponse.json({ status: 'ok' })
  }

  // Facebook Messenger
  if (body.object === 'page') {
    for (const entry of body.entry || []) {
      const pageId = entry.id
      for (const messaging of entry.messaging || []) {
        if (!messaging.message?.text) continue
        // Ignore messages sent by the page itself
        if (messaging.sender.id === pageId) continue

        const senderId = messaging.sender.id
        const text = messaging.message.text

        const { data: channel } = await supabase
          .from('channels')
          .select('tenant_id')
          .eq('meta_page_id', pageId)
          .eq('type', 'facebook')
          .single()

        if (!channel) {
          console.error('Facebook: no channel found for meta_page_id', pageId)
          continue
        }

        const result = await runAIPipeline({
          tenantId: channel.tenant_id,
          channelType: 'facebook',
          from: senderId,
          messageContent: text,
        })

        await sendFacebookReply(senderId, result.response)
      }
    }
    return NextResponse.json({ status: 'ok' })
  }

  return NextResponse.json({ status: 'ignored' })
}

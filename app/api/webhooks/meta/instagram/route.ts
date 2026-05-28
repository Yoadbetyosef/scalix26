import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runAIPipeline } from '@/lib/anthropic/pipeline'

// Meta webhook verification
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

export async function POST(req: NextRequest) {
  const body = await req.json()

  if (body.object !== 'instagram') {
    return NextResponse.json({ status: 'ignored' })
  }

  for (const entry of body.entry || []) {
    for (const messaging of entry.messaging || []) {
      if (!messaging.message?.text) continue

      const senderId = messaging.sender.id
      const recipientId = messaging.recipient.id
      const text = messaging.message.text

      const supabase = await createServiceClient()
      const { data: channel } = await supabase
        .from('channels')
        .select('tenant_id')
        .eq('meta_page_id', recipientId)
        .eq('type', 'instagram')
        .single()

      if (!channel) continue

      const result = await runAIPipeline({
        tenantId: channel.tenant_id,
        channelType: 'instagram',
        from: senderId,
        messageContent: text,
      })

      // Send reply via Meta Graph API
      await fetch(`https://graph.facebook.com/v18.0/me/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.META_PAGE_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          recipient: { id: senderId },
          message: { text: result.response },
        }),
      })
    }
  }

  return NextResponse.json({ status: 'ok' })
}

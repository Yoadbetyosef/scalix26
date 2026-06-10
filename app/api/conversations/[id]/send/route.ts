import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/twilio/client'

// Manually send a message to the customer on a conversation the human has
// taken over. The message is delivered on the conversation's channel and
// stored in the transcript as an 'agent' message.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const authed = await createClient()
  const { data: { user } } = await authed.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { content } = await req.json().catch(() => ({ content: undefined }))
  if (!content || typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: 'Message content is required' }, { status: 400 })
  }
  const text = content.trim()

  // Load conversation via RLS (owner only)
  const { data: conv } = await authed
    .from('conversations')
    .select('id, tenant_id, channel, human_takeover, contact:contacts(phone)')
    .eq('id', id)
    .single()

  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  if (!conv.human_takeover) {
    return NextResponse.json({ error: 'Take over the conversation before sending messages' }, { status: 400 })
  }

  const contactPhone = (conv.contact as { phone?: string } | null)?.phone || undefined
  const channel = conv.channel as string
  const service = await createServiceClient()

  let delivered = false
  let note = ''

  try {
    if (channel === 'sms' || channel === 'voice') {
      // Voice conversations have no live text channel — deliver as a follow-up SMS
      if (contactPhone) {
        const { data: ch } = await service
          .from('channels')
          .select('twilio_number')
          .eq('tenant_id', conv.tenant_id)
          .eq('type', 'sms')
          .not('twilio_number', 'is', null)
          .limit(1)
          .maybeSingle()
        await sendSMS(contactPhone, text, ch?.twilio_number || undefined)
        delivered = true
        if (channel === 'voice') note = 'Sent as SMS to the customer (voice calls have no text channel).'
      } else {
        note = 'No phone number on file — message saved to the thread but not delivered.'
      }
    } else if (channel === 'whatsapp') {
      if (contactPhone) {
        const { data: ch } = await service
          .from('channels')
          .select('twilio_number')
          .eq('tenant_id', conv.tenant_id)
          .eq('type', 'whatsapp')
          .limit(1)
          .maybeSingle()
        await sendSMS(`whatsapp:${contactPhone}`, text, ch?.twilio_number ? `whatsapp:${ch.twilio_number}` : undefined)
        delivered = true
      } else {
        note = 'No WhatsApp number on file — message saved to the thread but not delivered.'
      }
    } else if (channel === 'instagram' || channel === 'facebook') {
      // For Meta channels the recipient id is stored as the contact phone field
      const { data: ch } = await service
        .from('channels')
        .select('credentials')
        .eq('tenant_id', conv.tenant_id)
        .eq('type', channel)
        .limit(1)
        .maybeSingle()
      const token = (ch?.credentials as Record<string, string>)?.access_token || process.env.META_PAGE_ACCESS_TOKEN || ''
      if (contactPhone && token) {
        const res = await fetch('https://graph.facebook.com/v21.0/me/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { id: contactPhone }, message: { text }, access_token: token }),
        })
        if (!res.ok) {
          const err = await res.text()
          console.error(`[send] Meta ${channel} error:`, res.status, err)
          return NextResponse.json({ error: 'Failed to deliver message' }, { status: 502 })
        }
        delivered = true
      } else {
        note = 'Missing recipient or access token — message saved to the thread but not delivered.'
      }
    } else {
      note = 'Unsupported channel — message saved to the thread but not delivered.'
    }
  } catch (err) {
    console.error('[send] delivery failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to deliver message' }, { status: 502 })
  }

  // Record the agent message in the transcript
  const now = new Date().toISOString()
  await service.from('messages').insert({
    conversation_id: id,
    tenant_id: conv.tenant_id,
    role: 'agent',
    content: text,
    channel,
  })
  await service.from('conversations').update({ updated_at: now }).eq('id', id)

  return NextResponse.json({ ok: true, delivered, note })
}

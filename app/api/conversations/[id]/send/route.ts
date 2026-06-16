import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient, createAdminClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/twilio/client'
import { sendEmailReply } from '@/lib/email/send'
import { getProvider } from '@/lib/mailbox'
import { getValidAccount, type AccountRow } from '@/lib/mailbox/account'

const ACCOUNT_COLS = 'id, tenant_id, ai_employee_id, provider, email_address, access_token, refresh_token, token_expiry, scopes, history_id, status, created_at'

// Manually send a message to the customer on a conversation the human has taken
// over. Routes through the SAME per-channel senders the AI auto-reply uses, so a
// human can reply on any channel the AI can. The message is always stored in the
// transcript; `delivered` is true only on a successful send, and on failure the
// real reason is returned in `note`.
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

  // Load conversation via RLS (owner only).
  const { data: conv } = await authed
    .from('conversations')
    .select('id, tenant_id, channel, human_takeover, ai_employee_id, summary, contact:contacts(phone, email)')
    .eq('id', id)
    .single()

  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  if (!conv.human_takeover) {
    return NextResponse.json({ error: 'Take over the conversation before sending messages' }, { status: 400 })
  }

  const contact = conv.contact as { phone?: string; email?: string } | null
  const contactPhone = contact?.phone || undefined
  const contactEmail = contact?.email || undefined
  const channel = conv.channel as string
  const service = await createServiceClient()

  let delivered = false
  let note = ''

  try {
    if (channel === 'sms' || channel === 'voice') {
      // Voice conversations have no live text channel — deliver as a follow-up SMS.
      if (contactPhone) {
        const { data: ch } = await service
          .from('channels').select('twilio_number')
          .eq('tenant_id', conv.tenant_id).eq('type', 'sms').not('twilio_number', 'is', null)
          .limit(1).maybeSingle()
        await sendSMS(contactPhone, text, ch?.twilio_number || undefined)
        delivered = true
        if (channel === 'voice') note = 'Sent as SMS to the customer (voice calls have no text channel).'
      } else {
        note = 'No phone number on file — saved to the thread but not delivered.'
      }
    } else if (channel === 'whatsapp') {
      if (contactPhone) {
        const { data: ch } = await service
          .from('channels').select('twilio_number')
          .eq('tenant_id', conv.tenant_id).eq('type', 'whatsapp').limit(1).maybeSingle()
        await sendSMS(`whatsapp:${contactPhone}`, text, ch?.twilio_number ? `whatsapp:${ch.twilio_number}` : undefined)
        delivered = true
      } else {
        note = 'No WhatsApp number on file — saved to the thread but not delivered.'
      }
    } else if (channel === 'instagram' || channel === 'facebook') {
      // The Meta recipient id is stored in the contact phone field.
      const { data: ch } = await service
        .from('channels').select('credentials')
        .eq('tenant_id', conv.tenant_id).eq('type', channel).limit(1).maybeSingle()
      const token = (ch?.credentials as Record<string, string>)?.access_token || process.env.META_PAGE_ACCESS_TOKEN || ''
      if (contactPhone && token) {
        const res = await fetch('https://graph.facebook.com/v21.0/me/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { id: contactPhone }, message: { text }, access_token: token }),
        })
        if (res.ok) delivered = true
        else note = `${channel} send failed: ${res.status} ${(await res.text()).slice(0, 200)}`
      } else {
        note = 'Missing recipient or access token — saved to the thread but not delivered.'
      }
    } else if (channel === 'email') {
      if (!contactEmail) {
        note = 'No email address on file — saved to the thread but not delivered.'
      } else {
        // Threading: the last inbound email's Message-ID / Gmail thread id.
        const { data: lastIn } = await service
          .from('messages').select('email_message_id, email_thread_id')
          .eq('conversation_id', id).eq('channel', 'email').eq('role', 'user')
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        const subjectBase = conv.summary || 'your message'
        const subject = subjectBase.toLowerCase().startsWith('re:') ? subjectBase : `Re: ${subjectBase}`
        const inReplyTo = lastIn?.email_message_id || ''
        const threadId = lastIn?.email_thread_id || ''

        // Prefer a connected mailbox (Gmail) — sends natively from the owner's address.
        const admin = createAdminClient()
        let acctRow = (await admin.from('connected_email_accounts').select(ACCOUNT_COLS)
          .eq('ai_employee_id', conv.ai_employee_id).eq('status', 'connected').maybeSingle()).data
        if (!acctRow) acctRow = (await admin.from('connected_email_accounts').select(ACCOUNT_COLS)
          .eq('tenant_id', conv.tenant_id).eq('status', 'connected').limit(1).maybeSingle()).data

        if (acctRow) {
          const account = await getValidAccount(acctRow as AccountRow)
          if (!account) {
            note = 'Connected inbox needs reconnect — saved to the thread but not delivered.'
          } else {
            console.log(`[send] email via ${account.provider}-api from ${account.emailAddress} to ${contactEmail}`)
            await getProvider(account.provider).sendReply(account, { to: contactEmail, subject, body: text, threadId, inReplyTo, references: inReplyTo })
            delivered = true
          }
        } else {
          // Fall back to the existing Resend reply path (with threading).
          const { data: agent } = await service.from('ai_employees').select('reply_from_email').eq('id', conv.ai_employee_id).maybeSingle()
          console.log(`[send] email via resend to ${contactEmail}`)
          const sent = await sendEmailReply(contactEmail, agent?.reply_from_email, subject, text, inReplyTo || undefined)
          if (sent.success) delivered = true
          else note = `Email send failed: ${sent.error}`
        }
      }
    } else {
      note = `Unsupported channel "${channel}" — saved to the thread but not delivered.`
    }
  } catch (err) {
    note = `Send failed: ${err instanceof Error ? err.message : 'unknown error'}`
    console.error('[send] delivery failed:', note)
  }

  // Always record the agent message in the transcript.
  const now = new Date().toISOString()
  await service.from('messages').insert({ conversation_id: id, tenant_id: conv.tenant_id, role: 'agent', content: text, channel })
  await service.from('conversations').update({ updated_at: now }).eq('id', id)

  return NextResponse.json({ ok: true, delivered, note })
}

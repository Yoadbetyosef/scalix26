import { createAdminClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/twilio/client'
import { sendEmailReply } from '@/lib/email/send'
import { getProvider } from '@/lib/mailbox'
import { getValidAccount, type AccountRow } from '@/lib/mailbox/account'

const ACCOUNT_COLS = 'id, tenant_id, ai_employee_id, provider, email_address, access_token, refresh_token, token_expiry, scopes, history_id, status, created_at'

export interface DeliverResult { delivered: boolean; error?: string; externalId?: string }

/**
 * Deliver a message to a customer on an existing conversation, on WHATEVER channel that
 * conversation uses (SMS/WhatsApp/Instagram/Facebook/email). Mirrors the human-takeover send
 * route but is callable server-side (assistant action executors). Tenant-scoped. Records the
 * message in the transcript on success.
 */
export async function deliverToConversation(tenantId: string, conversationId: string, text: string): Promise<DeliverResult> {
  const db = createAdminClient()
  const { data: conv } = await db
    .from('conversations')
    .select('id, tenant_id, channel, ai_employee_id, summary, email_account_id, contact:contacts(phone, email)')
    .eq('id', conversationId).eq('tenant_id', tenantId).maybeSingle()
  if (!conv) return { delivered: false, error: 'Conversation not found.' }

  const contact = conv.contact as { phone?: string; email?: string } | null
  const contactPhone = contact?.phone || undefined
  const contactEmail = contact?.email || undefined
  const channel = conv.channel as string
  let externalId: string | undefined

  try {
    if (channel === 'sms' || channel === 'voice') {
      if (!contactPhone) return { delivered: false, error: 'No phone number on file for this customer.' }
      const { data: ch } = await db.from('channels').select('twilio_number').eq('tenant_id', tenantId).eq('type', 'sms').not('twilio_number', 'is', null).limit(1).maybeSingle()
      const res = await sendSMS(contactPhone, text, ch?.twilio_number || undefined)
      externalId = (res as { sid?: string })?.sid
    } else if (channel === 'whatsapp') {
      if (!contactPhone) return { delivered: false, error: 'No WhatsApp number on file.' }
      const { data: ch } = await db.from('channels').select('twilio_number').eq('tenant_id', tenantId).eq('type', 'whatsapp').limit(1).maybeSingle()
      const res = await sendSMS(`whatsapp:${contactPhone}`, text, ch?.twilio_number ? `whatsapp:${ch.twilio_number}` : undefined)
      externalId = (res as { sid?: string })?.sid
    } else if (channel === 'instagram' || channel === 'facebook') {
      const { data: ch } = await db.from('channels').select('credentials').eq('tenant_id', tenantId).eq('type', channel).limit(1).maybeSingle()
      const token = (ch?.credentials as Record<string, string>)?.access_token || process.env.META_PAGE_ACCESS_TOKEN || ''
      if (!contactPhone || !token) return { delivered: false, error: `${channel} is not fully connected (missing recipient or access token).` }
      const res = await fetch('https://graph.facebook.com/v21.0/me/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: contactPhone }, message: { text }, access_token: token }),
      })
      if (!res.ok) return { delivered: false, error: `${channel} send failed: ${res.status} ${(await res.text()).slice(0, 160)}` }
      externalId = ((await res.json()) as { message_id?: string })?.message_id
    } else if (channel === 'email') {
      if (!contactEmail) return { delivered: false, error: 'No email address on file for this customer.' }
      const { data: lastIn } = await db.from('messages').select('email_message_id, email_thread_id').eq('conversation_id', conversationId).eq('channel', 'email').eq('role', 'user').order('created_at', { ascending: false }).limit(1).maybeSingle()
      const subjectBase = conv.summary || 'your message'
      const subject = subjectBase.toLowerCase().startsWith('re:') ? subjectBase : `Re: ${subjectBase}`
      const inReplyTo = lastIn?.email_message_id || ''
      const threadId = lastIn?.email_thread_id || ''
      let acct: AccountRow | null = null
      if (conv.email_account_id) acct = (await db.from('connected_email_accounts').select(ACCOUNT_COLS).eq('id', conv.email_account_id).eq('status', 'connected').maybeSingle()).data as AccountRow | null
      if (!acct) acct = (await db.from('connected_email_accounts').select(ACCOUNT_COLS).eq('tenant_id', tenantId).eq('status', 'connected').order('is_primary', { ascending: false }).order('created_at', { ascending: true }).limit(1).maybeSingle()).data as AccountRow | null
      if (acct) {
        const account = await getValidAccount(acct)
        if (!account) return { delivered: false, error: 'The connected inbox needs to be reconnected.' }
        await getProvider(account.provider).sendReply(account, { to: contactEmail, subject, body: text, threadId, inReplyTo, references: inReplyTo })
      } else {
        const sent = await sendEmailReply(contactEmail, null, subject, text, inReplyTo || undefined)
        if (!sent.success) return { delivered: false, error: `Email send failed: ${sent.error}` }
      }
    } else {
      return { delivered: false, error: `Unsupported channel "${channel}".` }
    }

    await db.from('messages').insert({ conversation_id: conversationId, tenant_id: tenantId, role: 'agent', content: text, channel })
    await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)
    return { delivered: true, externalId }
  } catch (e) {
    return { delivered: false, error: (e as Error).message || 'Send failed.' }
  }
}

/** Find the conversation to act on: an explicit id, else the most recent one on `channel`. */
export async function resolveConversation(tenantId: string, channel: string, target?: string | null): Promise<string | null> {
  const db = createAdminClient()
  const isUuid = !!target && /^[0-9a-f-]{36}$/i.test(target)
  if (isUuid) {
    const { data } = await db.from('conversations').select('id').eq('id', target as string).eq('tenant_id', tenantId).maybeSingle()
    if (data) return data.id
  }
  const { data } = await db.from('conversations').select('id').eq('tenant_id', tenantId).eq('channel', channel).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  return data?.id ?? null
}

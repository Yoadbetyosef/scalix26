import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServiceClient, createAdminClient } from '@/lib/supabase/server'
import { sendEmail, sendEmailReply } from '@/lib/email/send'
import { generateEmailReply } from '@/lib/email/reply'
import { isNonCustomerEmail, domainsFromEmails } from '@/lib/email/is-non-customer'
import { claimEvent, completeEvent, fingerprint } from '@/lib/webhooks/idempotency'

const SECRET = process.env.RESEND_WEBHOOK_SECRET || process.env.RESEND_INBOUND_SECRET || ''

// Verify the Svix signature Resend sends (svix-id/timestamp/signature).
function verify(rawBody: string, headers: Headers): boolean {
  if (!SECRET) {
    // FAIL-CLOSED: without the Svix signing secret we cannot prove authenticity, so reject (except local
    // dev, where provider secrets aren't configured). Set RESEND_WEBHOOK_SECRET in Preview/Production.
    if (process.env.NODE_ENV === 'development') return true
    console.error('[email-inbound] RESEND_WEBHOOK_SECRET not set — rejecting unverifiable webhook.')
    return false
  }
  const id = headers.get('svix-id'); const ts = headers.get('svix-timestamp'); const sig = headers.get('svix-signature')
  if (!id || !ts || !sig) return false
  const secretBytes = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64')
  const expected = crypto.createHmac('sha256', secretBytes).update(`${id}.${ts}.${rawBody}`).digest('base64')
  return sig.split(' ').some((part) => {
    const s = part.split(',')[1]
    if (!s) return false
    try { return crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)) } catch { return false }
  })
}

function emailAddr(v: unknown): string {
  const s = Array.isArray(v) ? String(v[0] || '') : String(v || '')
  const m = s.match(/<([^>]+)>/)
  return (m ? m[1] : s).trim().toLowerCase()
}

// The webhook carries only metadata; the body comes from the Received Emails API.
async function fetchBody(emailId: string): Promise<{ from?: string; to?: unknown; subject?: string; text?: string; html?: string; message_id?: string } | null> {
  const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  })
  if (!r.ok) { console.error('[email-inbound] receiving fetch failed', r.status); return null }
  return r.json()
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verify(raw, req.headers)) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })

  let payload: { type?: string; data?: { email_id?: string; from?: string; to?: string; subject?: string } }
  try { payload = JSON.parse(raw) } catch { return NextResponse.json({ ok: true }) }
  if (payload.type !== 'email.received') return NextResponse.json({ ok: true })

  // Idempotency: Svix (Resend) re-delivers with the SAME svix-id on retry. Skip re-processing so a retry
  // never stores a duplicate inbound message or fires a second AI reply.
  const claim = await claimEvent('resend', req.headers.get('svix-id') || fingerprint('email', payload.data?.email_id), 'email')
  if (claim.unavailable) return NextResponse.json({ error: 'dedup store unavailable' }, { status: 503 }) // fail-closed
  if (claim.duplicate) { console.log('[email-inbound] duplicate delivery — skipping', req.headers.get('svix-id')); return NextResponse.json({ ok: true, duplicate: true }) }

  let from = payload.data?.from || ''
  let to: unknown = payload.data?.to || ''
  let subject = payload.data?.subject || ''
  let text = ''
  let inboundMessageId = ''
  const emailId = payload.data?.email_id
  if (emailId) {
    const full = await fetchBody(emailId)
    if (full) { from = full.from || from; to = full.to ?? to; subject = full.subject || subject; text = full.text || full.html || ''; inboundMessageId = full.message_id || '' }
  }

  const fromEmail = emailAddr(from)
  const toEmail = emailAddr(to)
  if (!toEmail) return NextResponse.json({ ok: true })
  const slug = toEmail.split('@')[0]

  const supabase = await createServiceClient()
  const { data: tenant } = await supabase
    .from('tenants').select('id, business_name, email').eq('slug', slug).maybeSingle()
  if (!tenant) { console.warn('[email-inbound] no tenant for slug', slug); return NextResponse.json({ ok: true }) }
  console.log('[email-inbound] tenant', tenant.id, 'slug', slug, 'from', fromEmail)

  // If this tenant has a connected OAuth mailbox (Gmail), that inbox + the /api/mailbox
  // poll own all replies — sent natively from the owner's address via Gmail API. The
  // Resend path must NOT also reply (it would go out from our domain and land in spam,
  // duplicating the Gmail reply). Connecting an inbox supersedes the forward path.
  const { data: connectedMbx } = await createAdminClient()
    .from('connected_email_accounts').select('email_address, provider')
    .eq('tenant_id', tenant.id).eq('status', 'connected').limit(1).maybeSingle()
  if (connectedMbx) {
    console.log(`[email-inbound] tenant has connected mailbox (${connectedMbx.provider}: ${connectedMbx.email_address}) — skipping Resend path; ${connectedMbx.provider}-api poll owns replies`)
    return NextResponse.json({ ok: true, skipped: 'connected-mailbox' })
  }

  // Real agent only: active preferred, else the tenant's earliest agent.
  const agentCols = 'id, name, system_prompt, business_name, email_auto_reply, reply_from_email, email_handoff_after_first_reply'
  let agent = (await supabase.from('ai_employees').select(agentCols)
    .eq('tenant_id', tenant.id).eq('status', 'active').maybeSingle()).data
  if (!agent) {
    agent = (await supabase.from('ai_employees').select(agentCols)
      .eq('tenant_id', tenant.id).order('created_at', { ascending: true }).limit(1).maybeSingle()).data
  }
  console.log('[email-inbound] agent', agent?.id || 'NONE', 'auto_reply', agent?.email_auto_reply)

  // Find / create the contact by email.
  let contactId: string | null = null
  const { data: c } = await supabase.from('contacts').select('id').eq('tenant_id', tenant.id).eq('email', fromEmail).maybeSingle()
  if (c) contactId = c.id
  else {
    const { data: nc } = await supabase.from('contacts').insert({ tenant_id: tenant.id, email: fromEmail, channel: 'email' }).select('id').single()
    contactId = nc?.id ?? null
  }

  // Find / create the open email conversation.
  const nowIso = new Date().toISOString()
  let convId: string | null = null
  let convTakeover = false
  const { data: existing } = await supabase.from('conversations')
    .select('id, human_takeover').eq('tenant_id', tenant.id).eq('contact_id', contactId).eq('channel', 'email').eq('status', 'open')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (existing) {
    convId = existing.id
    convTakeover = existing.human_takeover === true
    await supabase.from('conversations').update({ summary: subject, updated_at: nowIso }).eq('id', convId)
  } else {
    const { data: created } = await supabase.from('conversations')
      .insert({ tenant_id: tenant.id, ai_employee_id: agent?.id ?? null, contact_id: contactId, channel: 'email', status: 'open', summary: subject })
      .select('id').single()
    convId = created?.id ?? null
  }
  if (!convId) return NextResponse.json({ ok: true })

  const { data: inMsg } = await supabase.from('messages')
    .insert({ conversation_id: convId, tenant_id: tenant.id, role: 'user', content: text || '(no body)', channel: 'email' })
    .select('id').single()
  // Best-effort: store the inbound Message-ID so manual replies can thread (non-fatal pre-migration).
  if (inMsg && inboundMessageId) {
    const { error: thErr } = await supabase.from('messages').update({ email_message_id: inboundMessageId }).eq('id', inMsg.id)
    if (thErr) console.warn('[email-inbound] threading meta not stored (run add_message_email_threading.sql?):', thErr.message)
  }

  const ownerNote = (note: string) => tenant.email
    ? sendEmail(tenant.email, `New email from ${fromEmail}`,
        `<p>${note}</p><p><strong>From:</strong> ${fromEmail}<br/><strong>Subject:</strong> ${subject}</p><p>${(text || '').slice(0, 2000)}</p>`)
    : Promise.resolve()

  // 2a. If a human has taken over this email thread, the AI must never reply again.
  // The inbound message is already stored above — just notify the owner and stop.
  if (convTakeover) {
    console.log('[email-inbound] human_takeover active for conv', convId, '— storing only, notifying owner')
    await ownerNote('A customer replied in a conversation you have taken over.')
    return NextResponse.json({ ok: true, takenOver: true })
  }

  // Structured non-customer gate: never auto-reply to automated/notification/platform/
  // self/own-domain senders. The inbound message is already stored above (stays in the
  // Inbox); we just don't reply or treat it as a customer interaction.
  const { data: ncAccts } = await supabase.from('connected_email_accounts').select('email_address').eq('tenant_id', tenant.id)
  const ncReason = isNonCustomerEmail(fromEmail, domainsFromEmails((ncAccts || []).map((a) => a.email_address))).reason
  if (ncReason) {
    console.log('[email-inbound] non-customer sender, not auto-replying:', fromEmail, ncReason)
    return NextResponse.json({ ok: true, blocked: ncReason })
  }

  if (!agent) {
    // No configured agent — never auto-reply with a generic persona; notify owner.
    console.warn('[email-inbound] no agent for tenant ' + tenant.id + ', skipping auto-reply')
    await ownerNote('A customer emailed your AI address.')
  } else if (agent.email_auto_reply !== false) {
    try {
      console.log('[email-inbound] generating Claude reply for', fromEmail)
      const reply = await generateEmailReply({
        tenantId: tenant.id, agent, tenantBusinessName: tenant.business_name, emailText: text || '', subject,
      })
      console.log('[email-inbound] reply generated, length', reply.length)
      const sent = await sendEmailReply(fromEmail, agent.reply_from_email, subject, reply, inboundMessageId)
      if (sent.success) {
        console.log('[email-inbound] reply SENT to', fromEmail)
        await supabase.from('messages').insert({ conversation_id: convId, tenant_id: tenant.id, role: 'assistant', content: reply, channel: 'email' })
        // 2b. Acknowledge-then-handoff: after this one reply, hand the thread to the
        // human so every further inbound email hits the human_takeover branch (2a).
        if (agent.email_handoff_after_first_reply) {
          await supabase.from('conversations').update({ human_takeover: true }).eq('id', convId)
          console.log('[email-inbound] handoff-after-first-reply: conv', convId, '→ human_takeover')
        }
      } else {
        console.error('[email-inbound] reply send FAILED:', sent.error)
      }
    } catch (err) {
      console.error('[email-inbound] auto-reply error:', err instanceof Error ? err.message : err)
    }
  } else {
    console.log('[email-inbound] auto-reply OFF for tenant', tenant.id, '— notifying owner')
    await ownerNote('A customer emailed your AI address (auto-reply is off).')
  }

  await completeEvent(claim, tenant.id)
  return NextResponse.json({ ok: true })
}

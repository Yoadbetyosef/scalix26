import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'

const SECRET = process.env.RESEND_WEBHOOK_SECRET || process.env.RESEND_INBOUND_SECRET || ''

// Verify the Svix signature Resend sends (svix-id/timestamp/signature).
function verify(rawBody: string, headers: Headers): boolean {
  if (!SECRET) {
    console.warn('[email-inbound] no RESEND_WEBHOOK_SECRET set — skipping signature check')
    return true
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
async function fetchBody(emailId: string): Promise<{ from?: string; to?: unknown; subject?: string; text?: string; html?: string } | null> {
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

  let from = payload.data?.from || ''
  let to: unknown = payload.data?.to || ''
  let subject = payload.data?.subject || ''
  let text = ''
  const emailId = payload.data?.email_id
  if (emailId) {
    const full = await fetchBody(emailId)
    if (full) { from = full.from || from; to = full.to ?? to; subject = full.subject || subject; text = full.text || full.html || '' }
  }

  const fromEmail = emailAddr(from)
  const toEmail = emailAddr(to)
  if (!toEmail) return NextResponse.json({ ok: true })
  const slug = toEmail.split('@')[0]

  const supabase = await createServiceClient()
  const { data: tenant } = await supabase
    .from('tenants').select('id, business_name, email').eq('slug', slug).maybeSingle()
  if (!tenant) return NextResponse.json({ ok: true }) // unknown address — ignore

  const { data: agent } = await supabase
    .from('ai_employees').select('id, name, email_auto_reply').eq('tenant_id', tenant.id).eq('status', 'active').maybeSingle()

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
  const { data: existing } = await supabase.from('conversations')
    .select('id').eq('tenant_id', tenant.id).eq('contact_id', contactId).eq('channel', 'email').eq('status', 'open')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (existing) {
    convId = existing.id
    await supabase.from('conversations').update({ summary: subject, updated_at: nowIso }).eq('id', convId)
  } else {
    const { data: created } = await supabase.from('conversations')
      .insert({ tenant_id: tenant.id, ai_employee_id: agent?.id ?? null, contact_id: contactId, channel: 'email', status: 'open', summary: subject })
      .select('id').single()
    convId = created?.id ?? null
  }
  if (!convId) return NextResponse.json({ ok: true })

  await supabase.from('messages').insert({ conversation_id: convId, tenant_id: tenant.id, role: 'user', content: text || '(no body)', channel: 'email' })

  if (agent?.email_auto_reply) {
    // Schedule the reply 2 minutes out — gives the owner a window to take over.
    await supabase.from('conversations').update({ email_reply_due_at: new Date(Date.now() + 2 * 60 * 1000).toISOString() }).eq('id', convId)
  } else if (tenant.email) {
    // Auto-reply off → just notify the owner.
    await sendEmail(tenant.email, `New email from ${fromEmail}`,
      `<p>A customer emailed your AI address.</p><p><strong>From:</strong> ${fromEmail}<br/><strong>Subject:</strong> ${subject}</p><p>${(text || '').slice(0, 2000)}</p>`)
  }

  return NextResponse.json({ ok: true })
}

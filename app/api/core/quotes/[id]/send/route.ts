import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCoreTenant } from '@/lib/core/guard'
import { customerFacing, sendEmail } from '@/lib/email/send'
import { sendSMS } from '@/lib/twilio/client'
import { parseCc } from '@/lib/core/quotes'

// POST — send the quote to its customer, by email or text, with the link to their copy. The same
// shape as sending an invoice (../../documents/[type]/[id]/send), minus the one rule that does not
// apply: a quote does not have to be issued first, because it is not frozen by being sent.
const schema = z.object({
  /** One way, or both at once. */
  channel: z.enum(['email', 'sms', 'both']).optional(),
  to: z.string().trim().min(3).max(200).optional(),
})
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('invoices')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const db = createAdminClient()
  const { data: q } = await db.from('quotes')
    .select('id, number, status, total_cents, token, contact_id, valid_until, notes, client_name, cc_emails')
    .eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  if (!q) return NextResponse.json({ error: 'That quote no longer exists.' }, { status: 404 })
  if (!(Number(q.total_cents ?? 0) > 0)) return NextResponse.json({ error: 'Add something to the quote before sending it.' }, { status: 409 })

  const { data: contact } = q.contact_id
    ? await db.from('contacts').select('name, email, phone').eq('tenant_id', c.tenantId).eq('id', q.contact_id).maybeSingle()
    : { data: null }
  const who = contact as { name?: string | null; email?: string | null; phone?: string | null } | null
  // EMAIL UNLESS A TEXT WAS ASKED FOR. The editor has a button for each, so the channel is what was
  // pressed — not a guess from which details the customer happens to have. (It used to fall back to a
  // text when the customer had no email, which sent a quote by SMS to somebody who pressed "Send" and
  // had typed an email address into the copies field. Nothing reached that address at all.)
  const asked = parsed.data.channel ?? 'email'
  const byEmail = asked !== 'sms', byText = asked !== 'email'
  const copies = parseCc(q.cc_emails as string | null)
  // Everybody the quote goes to by email: the customer's own address first, then the copies.
  const emails = [...new Set([(byEmail ? (asked === 'email' ? (parsed.data.to ?? who?.email ?? '') : (who?.email ?? '')) : '').trim().toLowerCase(), ...copies].filter(Boolean))]
  const phone = (byText ? (asked === 'sms' ? (parsed.data.to ?? who?.phone ?? '') : (who?.phone ?? '')) : '').trim()
  if (byText && !phone) {
    return NextResponse.json({ error: 'There is no phone number for this customer. Add one to their contact, or send it by email.' }, { status: 400 })
  }
  if (asked === 'email' && !emails.length) {
    return NextResponse.json({ error: 'There is no email address on this quote. Type one under "Also send a copy to", or use Send by text.' }, { status: 400 })
  }

  const { data: tenant } = await db.from('tenants').select('business_name').eq('id', c.tenantId).maybeSingle()
  const biz = (tenant?.business_name as string) || 'us'
  const link = `${process.env.NEXT_PUBLIC_APP_URL || ''}/quote/${q.token}`
  const total = `$${(Number(q.total_cents ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const until = q.valid_until ? new Date(`${q.valid_until}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto">
    <p>Hi${who?.name ? ' ' + esc(who.name) : ''},</p>
    <p>Here is ${q.client_name ? `the quote for <strong>${esc(q.client_name as string)}</strong>, ` : 'your quote '}<strong>${esc(q.number as string)}</strong> from ${esc(biz)} for <strong>${total}</strong>${until ? `, valid until ${until}` : ''}.</p>
    ${q.notes ? `<p style="white-space:pre-wrap;border-left:3px solid #ddd;padding-left:12px;color:#333">${esc(q.notes as string)}</p>` : ''}
    <p><a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:12px 22px;border-radius:2px;text-decoration:none;letter-spacing:.06em">VIEW YOUR QUOTE</a></p>
    <p style="color:#666;font-size:13px">You can accept it from that page. Or open: ${link}</p>
  </div>`

  // Each address gets its own message, so nobody's address is shown to anybody else and one bad
  // address cannot stop the others.
  const delivered: string[] = [], failed: string[] = []
  let lastError: string | null = null
  try {
    if (byText) {
      const { data: ch } = await db.from('channels').select('twilio_number')
        .eq('tenant_id', c.tenantId).eq('type', 'sms').not('twilio_number', 'is', null).limit(1).maybeSingle()
      const from = (ch?.twilio_number as string) || process.env.TWILIO_PHONE_NUMBER
      if (!from) return NextResponse.json({ error: 'No SMS number is configured for this business.' }, { status: 400 })
      await sendSMS(phone, `${biz}: your quote ${q.number} for ${total}${until ? `, valid until ${until}` : ''}. ${link}`, from)
    }
    for (const e of emails) {
      const r = await sendEmail(e, `Your quote ${q.number} from ${biz} — ${total}`, html, customerFacing(biz, { tenantId: c.tenantId }))
      if (r.success) delivered.push(e); else { failed.push(e); lastError = r.error ?? null }
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'That could not be sent.' }, { status: 502 })
  }
  // By email and none of it went: nothing was sent, and saying otherwise is how a quote goes missing.
  if (asked === 'email' && !delivered.length) {
    return NextResponse.json({ error: `The email did not go out${lastError ? ` (${lastError})` : ''}. Nothing was sent.` }, { status: 502 })
  }
  // What actually happened, which for "both" may be only the text if every email was refused.
  const channel = byText && delivered.length && byEmail && asked === 'both' ? 'both' : byText ? 'sms' : 'email'
  const to = byText ? phone : delivered[0]
  const copied = byText ? delivered : delivered.slice(1)

  const at = new Date().toISOString()
  await db.from('quotes').update({ sent_at: at, sent_channel: channel, updated_at: at }).eq('tenant_id', c.tenantId).eq('id', id)
  await db.from('document_status_history').insert({
    tenant_id: c.tenantId, document_type: 'quote', document_id: id, from_status: q.status, to_status: q.status, actor: c.actor,
    note: byText
      ? `Sent by text to ${to}${copied.length ? ` and by email to ${copied.join(', ')}` : ''}`
      : `Sent by email to ${to}${copied.length ? `, copy to ${copied.join(', ')}` : ''}`,
  })
  return NextResponse.json({ ok: true, channel, to, copied, failed, sentAt: at, link })
}

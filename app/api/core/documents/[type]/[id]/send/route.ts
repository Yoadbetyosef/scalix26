import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCore } from '@/lib/core/guard'
import { customerFacing, sendEmail } from '@/lib/email/send'
import { sendSMS } from '@/lib/twilio/client'

// SEND AN INVOICE TO THE PERSON WHO OWES THE MONEY.
//
// A port of /api/studio/documents/[id]/send, not a generalisation of it: that route resolves against
// studio_documents, four of which are already in a real customer's hands, and its link is /d/. This one
// resolves against invoices and links to /i/. The reusable half — customerFacing(), the sendEmail
// success check, the SMS fallback — is imported rather than copied.
//
// ── A DRAFT IS NOT SENDABLE ─────────────────────────────────────────────────────────────────────
//
// Issuing is the irreversible half: it stamps the date, snapshots the payment details and freezes the
// total. Sending a draft would hand somebody a document whose number could still change, and /i/
// refuses to render one anyway — so the refusal belongs here, where it can say why, rather than as a
// 404 the owner has to interpret.
//
// ── EVERY SEND IS TWO WRITES ────────────────────────────────────────────────────────────────────
//
// `sent_at` means MOST RECENTLY sent, so a reminder overwrites the original. That is the right thing
// for "sent 3 days ago" on a list and the wrong thing for the question "when did they first get this?",
// which is exactly what a customer disputes. So every send also appends to document_status_history,
// where nothing is overwritten. The status does not change — sending is not a status transition — so
// the row carries the current status on both sides and puts the fact in the note.

const schema = z.object({
  channel: z.enum(['email', 'sms']).optional(),
  /** Optional: defaults to whatever is on the customer's record. */
  to: z.string().trim().min(3).max(200).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { type, id } = await params
  // Invoices only. The other document types have no public page to point anybody at, and a link that
  // 404s is worse than a button that is not there.
  if (type !== 'invoice') return NextResponse.json({ error: 'Only invoices can be sent from here.' }, { status: 400 })

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const db = createAdminClient()
  const { data: inv } = await db.from('invoices')
    .select('id, number, status, total_cents, currency, token, contact_id, due_on')
    .eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  if (!inv) return NextResponse.json({ error: 'That invoice no longer exists.' }, { status: 404 })
  if (inv.status === 'draft') {
    return NextResponse.json({ error: 'Issue it first — a draft can still change, so there is nothing to send yet.', reason: 'draft' }, { status: 409 })
  }
  if (!inv.token) return NextResponse.json({ error: 'That invoice has no link to send.' }, { status: 500 })

  const { data: contact } = inv.contact_id
    ? await db.from('contacts').select('name, email, phone').eq('tenant_id', c.tenantId).eq('id', inv.contact_id).maybeSingle()
    : { data: null }
  const who = contact as { name?: string | null; email?: string | null; phone?: string | null } | null

  // The channel follows the address unless the caller named one: an invoice goes by email when there
  // is an email, and by SMS when there is only a number.
  const channel = parsed.data.channel ?? (who?.email?.trim() ? 'email' : who?.phone?.trim() ? 'sms' : 'email')
  const to = (parsed.data.to ?? (channel === 'sms' ? who?.phone : who?.email) ?? '').trim()
  if (!to) {
    return NextResponse.json({
      error: channel === 'sms'
        ? 'There is no phone number for this customer. Add one, or send it by email.'
        : 'There is no email address for this customer. Add one, or send it by text.',
      reason: 'no_address',
    }, { status: 400 })
  }

  const { data: tenant } = await db.from('tenants').select('business_name').eq('id', c.tenantId).maybeSingle()
  const biz = (tenant?.business_name as string) || 'your supplier'
  const link = `${process.env.NEXT_PUBLIC_APP_URL || ''}/i/${inv.token}`
  const total = `$${(Number(inv.total_cents ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const due = inv.due_on ? new Date(`${inv.due_on}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : null

  try {
    if (channel === 'sms') {
      const { data: ch } = await db.from('channels').select('twilio_number')
        .eq('tenant_id', c.tenantId).eq('type', 'sms').not('twilio_number', 'is', null).limit(1).maybeSingle()
      const from = (ch?.twilio_number as string) || process.env.TWILIO_PHONE_NUMBER
      if (!from) return NextResponse.json({ error: 'No SMS number is configured for this business.' }, { status: 400 })
      await sendSMS(to, `${biz}: invoice ${inv.number} for ${total}${due ? `, due ${due}` : ''}. ${link}`, from)
    } else {
      const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto">
        <p>Hi${who?.name ? ' ' + who.name : ''},</p>
        <p>Here is invoice <strong>${inv.number}</strong> from ${biz} for <strong>${total}</strong>${due ? `, due ${due}` : ''}.</p>
        <p><a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">View invoice</a></p>
        <p style="color:#666;font-size:13px">Or open: ${link}</p>
      </div>`
      // Branded as the TENANT — the customer's inbox must not show our name as the sender of their
      // plumber's invoice. sendEmail returns { success } rather than throwing, so the catch below never
      // sees a refused send; without this check the invoice would be stamped sent for a message the
      // provider dropped. Same lesson the studio route already learned.
      const sent = await sendEmail(to, `Invoice ${inv.number} from ${biz} — ${total}`, html, customerFacing(biz, { tenantId: c.tenantId }))
      if (!sent.success) {
        return NextResponse.json({ error: `The email did not go out${sent.error ? ` (${sent.error})` : ''}. Nothing was sent.` }, { status: 502 })
      }
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'That could not be sent.' }, { status: 502 })
  }

  // Only now. Both writes happen after the send succeeded, never before it.
  const at = new Date().toISOString()
  await db.from('invoices').update({ sent_at: at, sent_channel: channel, updated_at: at })
    .eq('tenant_id', c.tenantId).eq('id', id)
  await db.from('document_status_history').insert({
    tenant_id: c.tenantId, document_type: 'invoice', document_id: id,
    from_status: inv.status, to_status: inv.status, actor: c.actor,
    note: `Sent by ${channel === 'sms' ? 'SMS' : 'email'} to ${to}`,
  })

  return NextResponse.json({ ok: true, channel, to, sentAt: at, link })
}

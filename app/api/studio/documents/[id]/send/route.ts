import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireStudioTenant } from '@/lib/studio/session'
import { customerFacing, sendEmail } from '@/lib/email/send'
import { sendSMS } from '@/lib/twilio/client'
import { DOC_META, docNumber, type StudioDocument, type StudioDocType } from '@/lib/studio/types'

// POST /api/studio/documents/[id]/send — deliver the document link to the client by email or SMS.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const channel = body.channel === 'sms' ? 'sms' : 'email'
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  if (!to) return NextResponse.json({ error: `A ${channel === 'sms' ? 'phone number' : 'email'} is required` }, { status: 400 })

  const db = createAdminClient()
  const { data: doc } = await db.from('studio_documents').select('*').eq('id', id).eq('tenant_id', s.tenantId).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const d = doc as StudioDocument
  const meta = DOC_META[d.type as StudioDocType]
  const { data: tenant } = await db.from('tenants').select('business_name').eq('id', s.tenantId).maybeSingle()
  const biz = tenant?.business_name || 'our studio'
  const link = `${process.env.NEXT_PUBLIC_APP_URL || ''}/d/${d.token}`
  const total = d.type !== 'production' ? ` (total $${Number(d.subtotal).toLocaleString()})` : ''

  try {
    if (channel === 'sms') {
      const { data: ch } = await db.from('channels').select('twilio_number').eq('tenant_id', s.tenantId).eq('type', 'sms').not('twilio_number', 'is', null).limit(1).maybeSingle()
      const from = ch?.twilio_number || process.env.TWILIO_PHONE_NUMBER
      if (!from) return NextResponse.json({ error: 'No SMS number is configured for this business' }, { status: 400 })
      await sendSMS(to, `${biz}: your ${meta.noun} ${docNumber(d)}${total}. View it here: ${link}`, from)
    } else {
      const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto">
        <p>Hi${d.party_name ? ' ' + d.party_name : ''},</p>
        <p>Here is your ${meta.noun} <strong>${docNumber(d)}</strong> from ${biz}${total}.</p>
        <p><a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">View ${meta.title}</a></p>
        <p style="color:#666;font-size:13px">Or open: ${link}</p>
      </div>`
      // Branded as the tenant. Without this the customer's inbox shows "Scalix" as the sender of
      // their jeweller's invoice. The ADDRESS stays the platform's verified domain — per-tenant
      // sending domains need per-tenant DNS — but the display name is theirs.
      await sendEmail(to, `${meta.title} ${docNumber(d)} from ${biz}`, html, customerFacing(biz, { tenantId: s.tenantId }))
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Send failed' }, { status: 502 })
  }

  await db.from('studio_documents').update({ sent_at: new Date().toISOString(), sent_channel: channel, updated_at: new Date().toISOString() }).eq('id', id).eq('tenant_id', s.tenantId)
  return NextResponse.json({ ok: true })
}

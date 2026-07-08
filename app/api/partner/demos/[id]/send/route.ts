import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos } from '@/lib/partner/roles'
import { sendEmail, emailTemplates } from '@/lib/email/send'
import { sendSMS } from '@/lib/twilio/client'

const PARTNER_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.scalix26.com'

// Send a demo link to a prospect by email and/or SMS.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const { email, phone } = await req.json().catch(() => ({}))
  if (!email && !phone) return NextResponse.json({ error: 'Provide an email or phone.' }, { status: 400 })

  const db = createAdminClient()
  const { data: demo } = await db.from('demos').select('public_slug, prospect_name').eq('id', id).eq('partner_id', ctx.partnerId).maybeSingle()
  if (!demo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const url = `${PARTNER_APP_URL}/demo/${demo.public_slug}`

  const sent: string[] = []
  if (email) {
    try { const t = emailTemplates.partnerDemo(demo.prospect_name, url); await sendEmail(email, t.subject, t.html); sent.push('email') } catch { /* best-effort */ }
  }
  if (phone) {
    try { await sendSMS(phone, `See your AI employee for ${demo.prospect_name} in action: ${url}`); sent.push('sms') } catch { /* best-effort */ }
  }
  if (!sent.length) return NextResponse.json({ error: 'Could not send — check the address/number.' }, { status: 400 })
  return NextResponse.json({ success: true, sent })
}

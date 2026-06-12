import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { intakeLead } from '@/lib/leads/speed-to-lead'
import type { LeadSource } from '@/types'

const VALID_SOURCES: LeadSource[] = ['missed_call', 'voice_call', 'web_form', 'google_lsa', 'facebook', 'yelp', 'angi', 'other']

// Secure per-tenant lead intake. The tenant is resolved from the secret token
// in the URL (not from the request body), so external lead sources can't spoof
// another tenant. Body: { phone, name?, source?, raw_data? }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  // Accept JSON or form-encoded/multipart bodies so plain web forms, Zapier,
  // and custom integrations all work.
  const contentType = req.headers.get('content-type') || ''
  let data: Record<string, unknown> = {}
  if (contentType.includes('application/json')) {
    data = (await req.json().catch(() => ({}))) as Record<string, unknown>
  } else {
    const form = await req.formData().catch(() => null)
    if (form) data = Object.fromEntries(form) as Record<string, unknown>
  }

  const phone = typeof data.phone === 'string' ? data.phone : undefined
  const name = typeof data.name === 'string' ? data.name : undefined
  // Source is optional; defaults to web_form (the common embed case)
  const source: LeadSource = VALID_SOURCES.includes(data.source as LeadSource) ? (data.source as LeadSource) : 'web_form'

  if (!phone) {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 })
  }

  const supabase = await createServiceClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('lead_intake_token', token)
    .maybeSingle()

  if (!tenant) {
    return NextResponse.json({ error: 'Invalid intake token' }, { status: 404 })
  }

  const result = await intakeLead({ tenantId: tenant.id, phone, name: name ?? null, source })

  if (result.error && !result.leadId) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    lead_id: result.leadId,
    sms_sent: result.smsSent,
    conversation_id: result.conversationId,
  })
}

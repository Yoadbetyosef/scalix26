import { NextRequest, NextResponse } from 'next/server'
import { intakeLead } from '@/lib/leads/speed-to-lead'
import type { LeadSource } from '@/types'

const VALID_SOURCES: LeadSource[] = ['missed_call', 'web_form', 'google_lsa', 'facebook', 'yelp', 'angi', 'other']

// Inbound lead intake. Creates a lead + contact, then fires Speed to Lead
// (instant outbound SMS). Open endpoint called by external lead sources, so it
// uses the service client (bypasses RLS) inside intakeLead().
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const { tenant_id, phone, name, source } = body as {
    tenant_id?: string
    phone?: string
    name?: string
    source?: LeadSource
    raw_data?: unknown
  }

  if (!tenant_id || !phone || !source) {
    return NextResponse.json({ error: 'tenant_id, phone and source are required' }, { status: 400 })
  }
  if (!VALID_SOURCES.includes(source)) {
    return NextResponse.json({ error: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}` }, { status: 400 })
  }

  const result = await intakeLead({ tenantId: tenant_id, phone, name: name ?? null, source })

  if (result.error && !result.leadId) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    lead_id: result.leadId,
    contact_id: result.contactId,
    sms_sent: result.smsSent,
    conversation_id: result.conversationId,
  })
}

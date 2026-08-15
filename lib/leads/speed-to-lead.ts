import { createServiceClient } from '@/lib/supabase/server'
import { primaryAgent } from '@/lib/agents/primary'
import { sendSMS } from '@/lib/twilio/client'
import { assertPartnerActive } from '@/lib/billing/gate'
import { writeCapturedName, looksLikeCapturedName } from '@/lib/contacts/ai-name'
import type { LeadSource } from '@/types'

interface SpeedToLeadInput {
  tenantId: string
  leadId: string
  contactId?: string | null
  phone: string
  name?: string | null
  source: LeadSource
}

interface SpeedToLeadResult {
  smsSent: boolean
  conversationId?: string
  error?: string
}

function buildMessage(source: LeadSource, name: string | null | undefined, employeeName: string, businessName: string): string {
  if (source === 'missed_call') {
    return `Hi! This is ${employeeName} from ${businessName}. Sorry we missed you — still need help? Reply YES and we'll call right back.`
  }
  if (source === 'voice_call') {
    // The caller already spoke with the AI — send a written confirmation, not a "reply YES".
    const g = name ? `Hi ${name}! ` : ''
    return `${g}Thanks for calling ${businessName}. We've got your details and someone will be in touch shortly. Reply here if you need anything in the meantime.`
  }
  const greeting = name ? `Hi ${name}! ` : ''
  return `${greeting}This is ${employeeName} from ${businessName}. We got your request — need help right now? Reply YES and we'll call you immediately.`
}

/**
 * Speed to Lead: instantly text a new lead. Sends an SMS templated by source
 * and the tenant's AI employee, marks the lead as contacted, and records a
 * conversation + first message in the existing tables.
 *
 * Does NOT touch the AI pipeline — this is a one-shot outbound SMS.
 */
export async function runSpeedToLead(input: SpeedToLeadInput): Promise<SpeedToLeadResult> {
  const supabase = await createServiceClient()
  const { tenantId, leadId, contactId, phone, name, source } = input

  // WL prepaid billing gate — a paused/depleted partner does not incur a new outbound SMS. The lead
  // row itself is created/updated by the caller (data untouched); only this billable text is withheld.
  // No-op for direct Scalix tenants and while WL_BILLING_ENABLED is off.
  if (!(await assertPartnerActive({ tenantId })).ok) return { smsSent: false, error: 'billing_paused' }

  // Tenant (for business name fallback) + active AI employee (name + from number)
  const [tenantRes, employeeRes, channelRes] = await Promise.all([
    supabase.from('tenants').select('business_name').eq('id', tenantId).maybeSingle(),
    // Was tenant+active straight into maybeSingle(): a second active employee made this null, and the
    // instant lead text went out signed "our team" from a business called "us".
    primaryAgent<{ id: string; name: string | null; business_name: string | null }>(supabase, tenantId, 'id, name, business_name'),
    supabase.from('channels').select('twilio_number').eq('tenant_id', tenantId).eq('type', 'sms').not('twilio_number', 'is', null).limit(1).maybeSingle(),
  ])

  const tenant = tenantRes.data
  const employee = employeeRes
  const fromNumber = channelRes.data?.twilio_number || undefined

  const employeeName = employee?.name || 'our team'
  const businessName = employee?.business_name || tenant?.business_name || 'us'
  const message = buildMessage(source, name, employeeName, businessName)

  // Send the SMS first — only mark the lead contacted if it actually goes out
  try {
    await sendSMS(phone, message, fromNumber)
  } catch (err) {
    console.error('[speed-to-lead] sendSMS failed:', err instanceof Error ? err.message : err)
    return { smsSent: false, error: 'sms_failed' }
  }

  const now = new Date().toISOString()

  // Mark the lead as contacted
  await supabase.from('leads').update({ responded_at: now, status: 'contacted' }).eq('id', leadId)

  // Record a conversation + first message in the existing tables
  let conversationId: string | undefined
  const { data: conv } = await supabase
    .from('conversations')
    .insert({
      tenant_id: tenantId,
      ai_employee_id: employee?.id ?? null,
      contact_id: contactId ?? null,
      channel: 'sms',
      status: 'open',
    })
    .select('id')
    .single()

  if (conv?.id) {
    conversationId = conv.id
    await supabase.from('messages').insert({
      conversation_id: conv.id,
      tenant_id: tenantId,
      role: 'assistant',
      content: message,
      channel: 'sms',
    })
    await supabase.from('conversations').update({ updated_at: now }).eq('id', conv.id)
  }

  if (contactId) {
    await supabase.from('contacts').update({ last_interaction: now }).eq('id', contactId)
  }

  return { smsSent: true, conversationId }
}

interface IntakeLeadInput {
  tenantId: string
  phone: string
  name?: string | null
  source: LeadSource
  issue?: string | null
}

interface IntakeLeadResult {
  leadId?: string
  contactId: string | null
  smsSent: boolean
  conversationId?: string
  error?: string
}

/**
 * Full lead intake: find/create the contact by phone+tenant, insert a lead,
 * then fire Speed to Lead. Shared by the inbound API and the missed-call
 * safety net. Uses the service client (bypasses RLS).
 */
export async function intakeLead(input: IntakeLeadInput): Promise<IntakeLeadResult> {
  const supabase = await createServiceClient()
  const { tenantId, phone, name, source, issue } = input

  // Find existing contact by phone + tenant, else create one
  let contactId: string | null = null
  const { data: existingContact } = await supabase
    .from('contacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .maybeSingle()

  if (existingContact) {
    contactId = existingContact.id
    // The name that arrived with the lead — from a web form, or from whatever the AI heard. This had
    // NO filter either.
    await writeCapturedName(supabase, contactId, name)
  } else {
    const { data: createdContact } = await supabase
      .from('contacts')
      .insert({ tenant_id: tenantId, phone, name: looksLikeCapturedName(name) ? name : null, channel: 'sms' })
      .select('id')
      .single()
    contactId = createdContact?.id ?? null
  }

  // Create the lead
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .insert({ tenant_id: tenantId, contact_id: contactId, source, phone, name: name ?? null, status: 'new' })
    .select('id')
    .single()

  if (leadErr || !lead) {
    return { contactId, smsSent: false, error: leadErr?.message || 'failed_to_create_lead' }
  }

  // Kick off a drip campaign for this lead (first follow-up in 2 hours).
  // Best-effort — never block or fail lead intake.
  try {
    const [empRes, chRes, tenantRes] = await Promise.all([
      primaryAgent<{ business_name: string | null }>(supabase, tenantId, 'business_name'),
      supabase.from('channels').select('twilio_number').eq('tenant_id', tenantId).eq('type', 'sms').not('twilio_number', 'is', null).limit(1).maybeSingle(),
      supabase.from('tenants').select('business_name').eq('id', tenantId).maybeSingle(),
    ])
    const businessName = empRes?.business_name || tenantRes.data?.business_name || 'us'
    const fromNumber = chRes.data?.twilio_number || null
    const nextSendAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    await supabase.from('drip_campaigns').insert({
      tenant_id: tenantId,
      lead_id: lead.id,
      contact_phone: phone,
      contact_name: name ?? null,
      issue: issue ?? null,
      business_name: businessName,
      from_number: fromNumber,
      status: 'active',
      messages_sent: 0,
      next_send_at: nextSendAt,
    })
  } catch (err) {
    console.error('[drip] start failed:', err instanceof Error ? err.message : err)
  }

  const result = await runSpeedToLead({ tenantId, leadId: lead.id, contactId, phone, name, source })
  return { leadId: lead.id, contactId, smsSent: result.smsSent, conversationId: result.conversationId, error: result.error }
}

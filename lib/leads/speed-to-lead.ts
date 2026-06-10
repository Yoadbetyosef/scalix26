import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/twilio/client'
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
    return `Hi! This is ${employeeName} from ${businessName}. Sorry we missed you — still need a locksmith? Reply YES and we'll call right back.`
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

  // Tenant (for business name fallback) + active AI employee (name + from number)
  const [tenantRes, employeeRes, channelRes] = await Promise.all([
    supabase.from('tenants').select('business_name').eq('id', tenantId).maybeSingle(),
    supabase.from('ai_employees').select('id, name, business_name').eq('tenant_id', tenantId).eq('status', 'active').maybeSingle(),
    supabase.from('channels').select('twilio_number').eq('tenant_id', tenantId).eq('type', 'sms').not('twilio_number', 'is', null).limit(1).maybeSingle(),
  ])

  const tenant = tenantRes.data
  const employee = employeeRes.data
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
  const { tenantId, phone, name, source } = input

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
    if (name) {
      await supabase.from('contacts').update({ name }).eq('id', contactId).is('name', null)
    }
  } else {
    const { data: createdContact } = await supabase
      .from('contacts')
      .insert({ tenant_id: tenantId, phone, name: name ?? null, channel: 'sms' })
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

  const result = await runSpeedToLead({ tenantId, leadId: lead.id, contactId, phone, name, source })
  return { leadId: lead.id, contactId, smsSent: result.smsSent, conversationId: result.conversationId, error: result.error }
}

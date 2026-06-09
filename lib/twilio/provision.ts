import twilio from 'twilio'
import { createServiceClient } from '@/lib/supabase/server'

export async function provisionAgentPhoneNumber(tenantId: string, agentId: string): Promise<string | null> {
  const supabase = await createServiceClient()

  // Idempotent: return existing number if this agent already has one
  const { data: existing } = await supabase
    .from('channels')
    .select('twilio_number')
    .eq('ai_employee_id', agentId)
    .eq('type', 'sms')
    .not('twilio_number', 'is', null)
    .maybeSingle()

  if (existing?.twilio_number) return existing.twilio_number

  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!

  const available = await client.availablePhoneNumbers('US').local.list({
    smsEnabled: true,
    voiceEnabled: true,
    limit: 5,
  })

  if (!available.length) return null

  const number = await client.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
    smsUrl: `${baseUrl}/api/webhooks/twilio/sms`,
    smsMethod: 'POST',
    voiceUrl: `${baseUrl}/api/webhooks/twilio/voice`,
    voiceMethod: 'POST',
  })

  await supabase.from('channels').insert([
    {
      tenant_id: tenantId,
      ai_employee_id: agentId,
      type: 'sms',
      twilio_number: number.phoneNumber,
      status: 'connected',
      credentials: { sid: number.sid },
    },
    {
      tenant_id: tenantId,
      ai_employee_id: agentId,
      type: 'voice',
      twilio_number: number.phoneNumber,
      status: 'connected',
      credentials: { sid: number.sid },
    },
  ])

  return number.phoneNumber
}

// Legacy alias kept for any remaining callers
export async function provisionTenantPhoneNumber(tenantId: string): Promise<string | null> {
  const supabase = await createServiceClient()

  const { data: agent } = await supabase
    .from('ai_employees')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle()

  if (!agent) return null
  return provisionAgentPhoneNumber(tenantId, agent.id)
}

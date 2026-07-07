import { createAdminClient } from '@/lib/supabase/server'

export type IntegrationKey = 'twilio' | 'instagram' | 'facebook' | 'stripe' | 'email' | 'calendar'

export interface IntegrationStatus {
  twilio: boolean
  instagram: boolean
  facebook: boolean
  stripe: boolean
  email: boolean
  calendar: boolean
}

// Real connection checks from the tenant's actual config — never assumed.
export async function getIntegrations(tenantId: string): Promise<IntegrationStatus> {
  const db = createAdminClient()
  const [channelsRes, tenantRes, emailRes, calRes] = await Promise.all([
    db.from('channels').select('type, status, twilio_number, meta_page_id').eq('tenant_id', tenantId),
    db.from('tenants').select('stripe_connect_charges_enabled').eq('id', tenantId).maybeSingle(),
    db.from('connected_email_accounts').select('id').eq('tenant_id', tenantId).limit(1).maybeSingle(),
    db.from('google_calendar_connections').select('id').eq('tenant_id', tenantId).limit(1).maybeSingle(),
  ])
  const ch = channelsRes.data || []
  const connected = (type: string, needMeta = false, needTwilio = false) =>
    ch.some((c) => c.type === type && c.status === 'connected' && (!needMeta || !!c.meta_page_id) && (!needTwilio || !!c.twilio_number))

  return {
    twilio: ch.some((c) => ['sms', 'whatsapp', 'voice'].includes(c.type) && c.status === 'connected' && !!c.twilio_number),
    instagram: connected('instagram', true),
    facebook: connected('facebook', true),
    stripe: !!tenantRes.data?.stripe_connect_charges_enabled,
    email: !!emailRes.data, // connected_email_accounts row present
    calendar: !!calRes.data, // google calendar connection present (best-effort; missing table → false)
  }
}

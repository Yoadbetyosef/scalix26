import { createAdminClient } from '@/lib/supabase/server'

export type IntegrationKey = 'twilio' | 'instagram' | 'facebook' | 'stripe' | 'email' | 'calendar' | 'outlook'

/** What a provider can actually say about itself. */
export type IntegrationState =
  | 'live'      // connected and working
  | 'review'    // handed to the provider and waiting on them — nothing for the person to do
  | 'connect'   // not set up

export interface IntegrationStatus {
  twilio: boolean
  instagram: boolean
  facebook: boolean
  stripe: boolean
  email: boolean
  calendar: boolean
  outlook: boolean
}

export type IntegrationStates = Record<keyof IntegrationStatus, IntegrationState>

// ONE READER. getIntegrations() keeps returning booleans for its existing callers — lib/assistant/
// execute.ts gates actions on them — and getIntegrationStates() returns the three-state view the
// connections page needs. Both derive from this single read, so they cannot disagree; a parallel
// module would have drifted the first time a provider was added to one and not the other.
//
// The distinction that earns the page is `review`: Meta hands a page connection to its own review
// queue, and until now that was collapsed into "not connected" — which reads as something the person
// failed to finish, when there is nothing for them to do.
async function read(tenantId: string) {
  const db = createAdminClient()
  const [channelsRes, tenantRes, emailRes, calRes, outlookRes] = await Promise.all([
    db.from('channels').select('type, status, twilio_number, meta_page_id').eq('tenant_id', tenantId),
    db.from('tenants').select('stripe_connect_charges_enabled').eq('id', tenantId).maybeSingle(),
    db.from('connected_email_accounts').select('id').eq('tenant_id', tenantId).limit(1).maybeSingle(),
    db.from('google_calendar_connections').select('id').eq('tenant_id', tenantId).limit(1).maybeSingle(),
    // A business on Microsoft cannot book without this, and only Google was ever checked. Same
    // pattern, same best-effort: a missing table reads as not connected rather than throwing.
    db.from('microsoft_calendar_connections').select('id').eq('tenant_id', tenantId).limit(1).maybeSingle(),
  ])
  const ch = channelsRes.data || []

  // The channel row's own status, not a collapsed boolean.
  const channelState = (type: string, needMeta = false, needTwilio = false): IntegrationState => {
    const rows = ch.filter((c) => c.type === type && (!needMeta || !!c.meta_page_id) && (!needTwilio || !!c.twilio_number))
    if (rows.some((c) => c.status === 'connected')) return 'live'
    if (rows.some((c) => c.status === 'pending' || c.status === 'in_review' || c.status === 'review')) return 'review'
    return 'connect'
  }

  const states: IntegrationStates = {
    twilio: ch.some((c) => ['sms', 'whatsapp', 'voice'].includes(c.type) && c.status === 'connected' && !!c.twilio_number)
      ? 'live'
      : ch.some((c) => ['sms', 'whatsapp', 'voice'].includes(c.type) && c.status === 'pending') ? 'review' : 'connect',
    instagram: channelState('instagram', true),
    facebook: channelState('facebook', true),
    stripe: tenantRes.data?.stripe_connect_charges_enabled ? 'live' : 'connect',
    email: emailRes.data ? 'live' : 'connect',
    calendar: calRes.data ? 'live' : 'connect',
    outlook: outlookRes.data ? 'live' : 'connect',
  }
  return states
}

/** The three-state view. What the connections page renders. */
export async function getIntegrationStates(tenantId: string): Promise<IntegrationStates> {
  return read(tenantId)
}

// Real connection checks from the tenant's actual config — never assumed.
//
// Unchanged for its callers: `true` still means live, and `review` is deliberately NOT true here. An
// action gated on an integration must not fire while the provider is still deciding.
export async function getIntegrations(tenantId: string): Promise<IntegrationStatus> {
  const s = await read(tenantId)
  return {
    twilio: s.twilio === 'live', instagram: s.instagram === 'live', facebook: s.facebook === 'live',
    stripe: s.stripe === 'live', email: s.email === 'live', calendar: s.calendar === 'live',
    outlook: s.outlook === 'live',
  }
}

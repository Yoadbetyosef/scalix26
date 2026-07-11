import twilio from 'twilio'
import { createAdminClient } from '@/lib/supabase/server'
import { getPartnerTwilio } from '@/lib/partner/integrations'

// Shared Twilio number-release logic. Extracted verbatim from the agent DELETE
// endpoint so the DELETE path and the Stripe-cancellation path use the exact same
// proven code: dedupe by SID (sms+voice share one number), treat Twilio 20404
// ("already released") as success, and persist any real failure to
// pending_number_releases for manual retry. These helpers NEVER throw.

type AdminClient = ReturnType<typeof createAdminClient>
type ChannelRow = {
  ai_employee_id: string | null
  twilio_number: string | null
  credentials: Record<string, string> | null
}

export type ReleaseResult = { released: number; alreadyGone: number; failed: number }

async function releaseFromChannels(
  supabase: AdminClient,
  tenantId: string,
  channels: ChannelRow[],
): Promise<ReleaseResult> {
  const res: ReleaseResult = { released: 0, alreadyGone: 0, failed: 0 }

  // SMS + voice rows share one SID/number — dedupe by SID.
  const sidToInfo = new Map<string, { number: string | null; agentId: string | null }>()
  for (const c of channels) {
    const sid = (c.credentials as Record<string, string> | null)?.sid
    if (sid && !sidToInfo.has(sid)) sidToInfo.set(sid, { number: c.twilio_number ?? null, agentId: c.ai_employee_id ?? null })
  }
  if (sidToInfo.size === 0) return res

  // Release against the account that OWNS the number: for a White Label client tenant the
  // number was provisioned on the PARTNER's Twilio subaccount, so releasing it from the
  // platform account would 20404 (no-op) and leave the partner paying for an orphan. Resolve
  // the tenant's partner Twilio and use it; fall back to the platform account otherwise.
  let accountSid = process.env.TWILIO_ACCOUNT_SID!
  let authToken = process.env.TWILIO_AUTH_TOKEN!
  const { data: tRow } = await supabase.from('tenants').select('white_label_partner_id').eq('id', tenantId).maybeSingle()
  if (tRow?.white_label_partner_id) {
    const partnerTwilio = await getPartnerTwilio(tRow.white_label_partner_id)
    if (partnerTwilio) {
      accountSid = partnerTwilio.accountSid
      authToken = partnerTwilio.authToken
      console.log('[release] using partner Twilio for WL client tenant', tenantId)
    }
  }
  const client = twilio(accountSid, authToken)
  for (const [sid, info] of sidToInfo) {
    try {
      await client.incomingPhoneNumbers(sid).remove()
      res.released++
      console.log('[release] released Twilio number', info.number, sid)
    } catch (err) {
      // Twilio 20404 = number not found / already released → treat as success (idempotent).
      const code = (err as { code?: number }).code
      if (code === 20404) {
        res.alreadyGone++
        console.log('[release] Twilio number already released (20404):', info.number, sid)
        continue
      }
      res.failed++
      const message = err instanceof Error ? err.message : String(err)
      console.error('[release] release FAILED — persisting for retry:', { sid, number: info.number, tenantId, message })
      const { error: persistErr } = await supabase.from('pending_number_releases').insert({
        tenant_id: tenantId,
        ai_employee_id: info.agentId,
        twilio_sid: sid,
        twilio_number: info.number,
        error: message,
      })
      if (persistErr) {
        console.error('[release][CRITICAL] could not persist pending release — SID needs manual release:', { sid, number: info.number, tenantId, persistError: persistErr.message })
      }
    }
  }
  return res
}

// Per-AGENT release (used by the agent DELETE endpoint). Collects the agent's
// channel SIDs and releases them. Does NOT delete the agent — the caller does that
// afterwards (the cascade wipes the channel rows). Uses the caller's admin client.
export async function releaseAgentNumber(supabase: AdminClient, agentId: string, tenantId: string): Promise<ReleaseResult> {
  const { data: channels } = await supabase
    .from('channels')
    .select('ai_employee_id, twilio_number, credentials')
    .eq('ai_employee_id', agentId)
    .in('type', ['sms', 'voice'])
    .not('twilio_number', 'is', null)
  return releaseFromChannels(supabase, tenantId, (channels || []) as ChannelRow[])
}

// Tenant-wide release (used by Stripe cancellation). Releases every number across
// the tenant's channels, then marks those channel rows disconnected. NEVER throws —
// a failure here must never break the webhook.
export async function releaseTenantNumbers(tenantId: string): Promise<ReleaseResult> {
  const supabase = createAdminClient()
  try {
    const { data: channels } = await supabase
      .from('channels')
      .select('id, ai_employee_id, twilio_number, credentials')
      .eq('tenant_id', tenantId)
      .in('type', ['sms', 'voice'])
      .not('twilio_number', 'is', null)
    const rows = (channels || []) as (ChannelRow & { id: string })[]

    const result = await releaseFromChannels(supabase, tenantId, rows)

    // Mark the released channel rows disconnected so the app reflects the number is gone.
    const ids = rows.map((r) => r.id)
    if (ids.length > 0) {
      await supabase.from('channels').update({ status: 'disconnected' }).in('id', ids)
    }
    return result
  } catch (err) {
    console.error('[release] releaseTenantNumbers failed (non-fatal):', err instanceof Error ? err.message : err)
    return { released: 0, alreadyGone: 0, failed: 0 }
  }
}

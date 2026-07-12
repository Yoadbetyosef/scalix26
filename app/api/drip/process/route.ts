import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/twilio/client'
import { cronAuthorized } from '@/lib/cron/auth'
import { assertPartnerActive } from '@/lib/billing/gate'

// Quiet hours: no sends between 21:00 and 08:00 (business timezone).
const QUIET_TZ = 'America/New_York'

function businessHour(): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: QUIET_TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date())
  return parseInt(h, 10)
}

function dripMessage(n: number, name: string | null, business: string, issue: string | null): string {
  const who = name || 'there'
  const what = issue || 'service'
  if (n === 0) {
    return `Hi ${who}! This is the team at ${business}. Still need help with your ${what}? We have availability today. Reply YES and we'll call you right back. Reply STOP to opt out.`
  }
  if (n === 1) {
    return `Hi ${who}, following up from ${business}. We want to make sure you're taken care of. Still need ${what} resolved? Call us anytime. Reply STOP to opt out.`
  }
  return `Last check-in from ${business} — if you still need help with ${what}, we're here. Reply STOP to opt out.`
}

type Campaign = {
  id: string
  tenant_id: string
  lead_id: string
  contact_phone: string
  contact_name: string | null
  issue: string | null
  business_name: string | null
  from_number: string | null
  messages_sent: number
}

async function handle(req: NextRequest) {
  // Fail-closed: Vercel Cron auto-attaches `Authorization: Bearer <CRON_SECRET>`. A missing secret
  // no longer falls open — a deployed job with no configured secret is rejected.
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Quiet hours — skip this run, the next hourly cron retries.
  const hour = businessHour()
  if (hour >= 21 || hour < 8) {
    return NextResponse.json({ skipped: 'quiet_hours', hour })
  }

  const supabase = await createServiceClient()
  const nowIso = new Date().toISOString()

  const { data: campaigns } = await supabase
    .from('drip_campaigns')
    .select('id, tenant_id, lead_id, contact_phone, contact_name, issue, business_name, from_number, messages_sent')
    .eq('status', 'active')
    .lte('next_send_at', nowIso)
    .limit(200)

  let sent = 0, stopped = 0, completed = 0, blocked = 0
  // WL prepaid billing gate — cached per tenant for this run so a paused/depleted partner sends no drip
  // SMS. The campaign is left untouched (not advanced/stopped) so it simply resumes after a top-up.
  const gateCache = new Map<string, boolean>()
  const partnerAllowsSend = async (tenantId: string): Promise<boolean> => {
    const cached = gateCache.get(tenantId)
    if (cached !== undefined) return cached
    const ok = (await assertPartnerActive({ tenantId })).ok
    gateCache.set(tenantId, ok)
    return ok
  }
  for (const c of (campaigns || []) as Campaign[]) {
    // Safety net: never message a lead that's already booked or dismissed.
    const { data: lead } = await supabase.from('leads').select('status').eq('id', c.lead_id).maybeSingle()
    if (!lead || lead.status === 'booked' || lead.status === 'dismissed') {
      await supabase.from('drip_campaigns').update({ status: 'stopped', updated_at: nowIso }).eq('id', c.id)
      stopped++
      continue
    }

    // Billing-paused partner → skip this send; leave the campaign to retry after the balance is topped up.
    if (!(await partnerAllowsSend(c.tenant_id))) { blocked++; continue }

    const n = c.messages_sent || 0
    const text = dripMessage(n, c.contact_name, c.business_name || 'us', c.issue)
    try {
      await sendSMS(c.contact_phone, text, c.from_number || undefined, { tenantId: c.tenant_id })
    } catch (err) {
      console.error('[drip] send failed', c.id, err instanceof Error ? err.message : err)
      continue // leave the campaign as-is; retried next hour
    }

    const updates: Record<string, unknown> = { messages_sent: n + 1, updated_at: nowIso }
    if (n === 0) {
      updates.next_send_at = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() // +2 days
    } else if (n === 1) {
      updates.next_send_at = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() // +3 days
    } else {
      updates.status = 'completed'
      updates.next_send_at = null
      completed++
    }
    await supabase.from('drip_campaigns').update(updates).eq('id', c.id)
    sent++
  }

  return NextResponse.json({ ok: true, processed: campaigns?.length || 0, sent, stopped, completed, blocked })
}

// Vercel Cron invokes with GET; allow POST for manual triggering too.
export const GET = handle
export const POST = handle

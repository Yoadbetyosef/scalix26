import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { getPartnerTwilio } from '@/lib/partner/integrations'
import { provisionAgentPhoneNumber } from '@/lib/twilio/provision'
import { decrypt } from '@/lib/mailbox/crypto'
import { claimMetaPages } from '@/lib/meta/connect'
import twilio from 'twilio'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: agentId } = await params
  const body = await req.json()
  const { action, type } = body

  // Admin client (operator-safe): createServiceClient downgrades to the operator's JWT under RLS, which
  // would scope reads/writes — and critically the white_label_partner_id lookup below — to the partner's
  // OWN tenant, mis-routing a WL client's provisioning to the platform Twilio. Ownership is validated below.
  const serviceSupabase = createAdminClient()

  // Verify the agent belongs to this user's tenant
  const { data: agent } = await serviceSupabase
    .from('ai_employees')
    .select('id, tenant_id')
    .eq('id', agentId)
    .single()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Authorize against the active workspace (owner tenant, or the validated client tenant a White
  // Label partner switched into). Writes go ONLY to the active tenant.
  const activeTenantId = await getActiveTenantId()
  if (!activeTenantId || agent.tenant_id !== activeTenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // White-label client tenants provision through their OWNER partner's own Twilio account (they pay).
  const { data: tRow } = await serviceSupabase.from('tenants').select('white_label_partner_id').eq('id', agent.tenant_id).maybeSingle()
  const partnerTwilio = tRow?.white_label_partner_id ? await getPartnerTwilio(tRow.white_label_partner_id) : null

  // ── Provision phone number ──────────────────────────────────────────────────
  if (action === 'provision_phone') {
    try {
      const phoneNumber = await provisionAgentPhoneNumber(agent.tenant_id, agentId, partnerTwilio || undefined)
      if (!phoneNumber) return NextResponse.json({ error: 'No phone numbers available' }, { status: 503 })
      return NextResponse.json({ phoneNumber })
    } catch (err) {
      console.error('[agents/channels] Phone provision failed:', err)
      return NextResponse.json({ error: 'Phone provisioning failed' }, { status: 500 })
    }
  }

  // ── Release phone number ────────────────────────────────────────────────────
  if (action === 'release_phone') {
    const { data: phoneChannels } = await serviceSupabase
      .from('channels')
      .select('id, credentials, twilio_number')
      .eq('ai_employee_id', agentId)
      .in('type', ['sms', 'voice'])
      .not('twilio_number', 'is', null)

    if (phoneChannels?.length) {
      const sid = (phoneChannels[0].credentials as Record<string, string>)?.sid
      if (sid) {
        try {
          // Release against the account that owns the number: a WL client's number lives on the
          // partner's Twilio subaccount, so use partner creds when present (else the platform account).
          const client = partnerTwilio
            ? twilio(partnerTwilio.accountSid, partnerTwilio.authToken)
            : twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
          await client.incomingPhoneNumbers(sid).remove()
        } catch (err) {
          console.error('[agents/channels] Twilio release failed:', err)
        }
      }
      const channelIds = phoneChannels.map(c => c.id)
      await serviceSupabase.from('channels').delete().in('id', channelIds)
    }
    return NextResponse.json({ success: true })
  }

  // ── Connect Facebook or Instagram ───────────────────────────────────────────
  if (action === 'connect_social' && (type === 'facebook' || type === 'instagram')) {
    const { pageId, accessToken } = body
    if (!pageId || !accessToken) {
      return NextResponse.json({ error: 'pageId and accessToken are required' }, { status: 400 })
    }

    const { error } = await claimMetaPages(serviceSupabase, {
      tenantId: agent.tenant_id, agentId,
      pages: [{ type, metaPageId: pageId, credentials: { access_token: accessToken } }],
    })
    if (error) return NextResponse.json({ error }, { status: 409 })
    return NextResponse.json({ success: true })
  }

  // ── Connect via OAuth (from page picker after Meta OAuth flow) ─────────────
  if (action === 'connect_social_oauth') {
    const { pageId, pageName, accessToken, instagram } = body
    if (!pageId || !accessToken) {
      return NextResponse.json({ error: 'pageId and accessToken are required' }, { status: 400 })
    }

    const pages: { type: 'facebook' | 'instagram'; metaPageId: string; credentials: Record<string, string> }[] = [
      { type: 'facebook', metaPageId: pageId, credentials: { access_token: accessToken, page_name: pageName } },
    ]
    if (instagram?.id) {
      pages.push({ type: 'instagram', metaPageId: instagram.id, credentials: { access_token: accessToken, page_id: pageId, username: instagram.username } })
    }
    const { error } = await claimMetaPages(serviceSupabase, { tenantId: agent.tenant_id, agentId, pages })
    if (error) return NextResponse.json({ error }, { status: 409 })
    return NextResponse.json({ success: true })
  }

  // ── Disconnect a connected email mailbox (OAuth) ────────────────────────────
  if (action === 'disconnect_email') {
    const adminSupabase = createAdminClient() // bypass RLS for token table
    // Optional accountId → disconnect just THAT mailbox; otherwise disconnect all.
    const accountId = typeof body.accountId === 'string' ? body.accountId : null
    let q = adminSupabase.from('connected_email_accounts')
      .select('id, provider, refresh_token, is_primary').eq('ai_employee_id', agentId)
    if (accountId) q = q.eq('id', accountId)
    const { data: accounts } = await q

    let removedPrimary = false
    for (const acct of accounts || []) {
      if (acct.is_primary) removedPrimary = true
      // Best-effort token revocation at the provider, then remove the row.
      if (acct.provider === 'google' && acct.refresh_token) {
        try {
          const token = decrypt(acct.refresh_token)
          await fetch('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }),
          })
        } catch (err) {
          console.error('[agents/channels] google revoke failed:', err)
        }
      }
    }
    if (accountId) await adminSupabase.from('connected_email_accounts').delete().eq('id', accountId).eq('ai_employee_id', agentId)
    else await adminSupabase.from('connected_email_accounts').delete().eq('ai_employee_id', agentId)

    // If we removed the primary but other mailboxes remain, promote the earliest one.
    if (removedPrimary) {
      const { data: rest } = await adminSupabase.from('connected_email_accounts')
        .select('id').eq('ai_employee_id', agentId).order('created_at', { ascending: true }).limit(1)
      if (rest && rest[0]) await adminSupabase.from('connected_email_accounts').update({ is_primary: true }).eq('id', rest[0].id)
    }
    return NextResponse.json({ success: true })
  }

  // ── Set a connected mailbox as the agent's PRIMARY (reply-from fallback) ─────
  if (action === 'set_primary_email') {
    const accountId = typeof body.accountId === 'string' ? body.accountId : ''
    if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })
    const adminSupabase = createAdminClient()
    await adminSupabase.from('connected_email_accounts').update({ is_primary: false }).eq('ai_employee_id', agentId)
    const { error } = await adminSupabase.from('connected_email_accounts')
      .update({ is_primary: true }).eq('id', accountId).eq('ai_employee_id', agentId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }

  // ── Disconnect a channel ────────────────────────────────────────────────────
  if (action === 'disconnect' && type) {
    await serviceSupabase
      .from('channels')
      .update({ status: 'disconnected' })
      .eq('ai_employee_id', agentId)
      .eq('type', type)

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

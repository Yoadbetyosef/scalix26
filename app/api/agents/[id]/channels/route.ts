import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient, createAdminClient } from '@/lib/supabase/server'
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

  const serviceSupabase = await createServiceClient()

  // Verify the agent belongs to this user's tenant
  const { data: agent } = await serviceSupabase
    .from('ai_employees')
    .select('id, tenant_id')
    .eq('id', agentId)
    .single()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { data: tenant } = await serviceSupabase
    .from('tenants')
    .select('id')
    .eq('id', agent.tenant_id)
    .eq('user_id', user.id)
    .single()

  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── Provision phone number ──────────────────────────────────────────────────
  if (action === 'provision_phone') {
    try {
      const phoneNumber = await provisionAgentPhoneNumber(agent.tenant_id, agentId)
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
          const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
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
    const { data: accounts } = await adminSupabase
      .from('connected_email_accounts')
      .select('id, provider, refresh_token')
      .eq('ai_employee_id', agentId)

    for (const acct of accounts || []) {
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
    await adminSupabase.from('connected_email_accounts').delete().eq('ai_employee_id', agentId)
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

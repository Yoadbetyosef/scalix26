import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/twilio/client'
import { hoursToSlots, type DayHours } from '@/lib/appointments'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: agentId } = await params
  const body = await req.json()

  // True service role (NOT createServiceClient — that's the cookie-based SSR client,
  // which gets DOWNGRADED to the logged-in user's JWT and runs under RLS. With no
  // permissive UPDATE policy on ai_employees, the .update() silently affected 0 rows
  // and returned no error — so saves (business_hours, etc.) reported success but never
  // persisted. We verify ownership manually below, then write with admin to bypass RLS.
  const serviceSupabase = createAdminClient()

  // Verify ownership (+ old forward number / names for the one-time welcome SMS)
  const { data: agent } = await serviceSupabase
    .from('ai_employees')
    .select('id, tenant_id, forward_to_phone, name, business_name')
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

  const allowed = [
    'name', 'greeting', 'personality', 'personality_score', 'voice', 'system_prompt', 'status',
    'business_name', 'industry', 'website', 'phone', 'email', 'address', 'city', 'state', 'zip',
    'business_hours', 'timezone', 'forward_to_phone',
    'email_auto_reply', 'reply_from_email', 'voice_language', 'email_handoff_after_first_reply',
  ]

  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await serviceSupabase
      .from('ai_employees')
      .update(updates)
      .eq('id', agentId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Weekly hours are the appointment_slots table (the booking source of truth),
  // NOT a column on ai_employees. The UI sends per-day open/close ranges; expand
  // them into hourly bookable slots and replace the tenant's slots. Admin client
  // bypasses RLS (the old client-side delete/insert silently failed under RLS).
  if (body.weekly_hours && typeof body.weekly_hours === 'object') {
    const weekly = body.weekly_hours as Record<string, DayHours>
    const rows = hoursToSlots(weekly).map(r => ({ ...r, tenant_id: agent.tenant_id, is_active: true }))
    const { error: delErr } = await serviceSupabase.from('appointment_slots').delete().eq('tenant_id', agent.tenant_id)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 })
    if (rows.length > 0) {
      const { error: insErr } = await serviceSupabase.from('appointment_slots').insert(rows)
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 })
    }
  }

  // One-time welcome "text yourself" SMS: fires only when the owner FIRST sets their
  // forward number (empty → set transition), texted from the agent's provisioned
  // number so they can reply and test it. Non-fatal; never blocks the save.
  const oldForward = (agent.forward_to_phone || '').trim()
  const newForward = typeof body.forward_to_phone === 'string' ? body.forward_to_phone.trim() : oldForward
  if ('forward_to_phone' in body && !oldForward && newForward) {
    try {
      const { data: ch } = await serviceSupabase
        .from('channels').select('twilio_number')
        .eq('ai_employee_id', agentId).not('twilio_number', 'is', null).limit(1).maybeSingle()
      const fromNumber = ch?.twilio_number
      if (fromNumber) {
        const who = agent.name || `${agent.business_name || 'your business'} AI`
        const biz = agent.business_name || 'your business'
        await sendSMS(newForward, `🎉 Your AI is live! This is ${who} from ${biz}. Reply to this message to test me out — I'm ready to book jobs 24/7.`, fromNumber)
        console.log('[agents/PATCH] welcome SMS sent to', newForward, 'from', fromNumber)
      } else {
        console.log('[agents/PATCH] welcome SMS skipped — no provisioned number for agent', agentId)
      }
    } catch (err) {
      console.error('[agents/PATCH] welcome SMS failed:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: agentId } = await params
  const serviceSupabase = createAdminClient() // true service role; ownership verified below

  // Verify ownership (same as PATCH).
  const { data: agent } = await serviceSupabase
    .from('ai_employees').select('id, tenant_id').eq('id', agentId).single()
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { data: tenant } = await serviceSupabase
    .from('tenants').select('id').eq('id', agent.tenant_id).eq('user_id', user.id).single()
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 1) BEFORE deleting (the cascade will wipe channel rows): collect Twilio SIDs.
  const { data: channels } = await serviceSupabase
    .from('channels')
    .select('twilio_number, credentials')
    .eq('ai_employee_id', agentId)
    .in('type', ['sms', 'voice'])
    .not('twilio_number', 'is', null)

  // SMS + voice rows share one SID/number — dedupe by SID.
  const sidToNumber = new Map<string, string | null>()
  for (const c of channels || []) {
    const sid = (c.credentials as Record<string, string> | null)?.sid
    if (sid && !sidToNumber.has(sid)) sidToNumber.set(sid, c.twilio_number ?? null)
  }

  // 2) Release each number. A failure must never drop the SID silently — log it
  //    AND persist it for manual retry. It must not block the deletion.
  if (sidToNumber.size > 0) {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
    for (const [sid, number] of sidToNumber) {
      try {
        await client.incomingPhoneNumbers(sid).remove()
        console.log('[agent-delete] released Twilio number', number, sid)
      } catch (err) {
        // Twilio 20404 = number not found / already released → treat as success.
        const code = (err as { code?: number }).code
        if (code === 20404) {
          console.log('[agent-delete] Twilio number already released (20404):', number, sid)
          continue
        }
        const message = err instanceof Error ? err.message : String(err)
        console.error('[agent-delete] release FAILED — persisting for retry:', { sid, number, agentId, message })
        const { error: persistErr } = await serviceSupabase.from('pending_number_releases').insert({
          tenant_id: agent.tenant_id,
          ai_employee_id: agentId,
          twilio_sid: sid,
          twilio_number: number,
          error: message,
        })
        if (persistErr) {
          // Last-resort durable trace if even the insert fails.
          console.error('[agent-delete][CRITICAL] could not persist pending release — SID needs manual release:', { sid, number, agentId, persistError: persistErr.message })
        }
      }
    }
  }

  // 3) THEN delete the agent (cascades the channel rows).
  const { error } = await serviceSupabase.from('ai_employees').delete().eq('id', agentId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}

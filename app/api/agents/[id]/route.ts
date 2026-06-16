import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: agentId } = await params
  const body = await req.json()

  const serviceSupabase = await createServiceClient()

  // Verify ownership
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

  const allowed = [
    'name', 'greeting', 'personality', 'personality_score', 'voice', 'system_prompt', 'status',
    'business_name', 'industry', 'website', 'phone', 'email', 'address', 'city', 'state', 'zip',
    'business_hours', 'timezone', 'forward_to_phone',
    'email_auto_reply', 'reply_from_email', 'voice_language',
  ]

  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { error } = await serviceSupabase
    .from('ai_employees')
    .update(updates)
    .eq('id', agentId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

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
  const serviceSupabase = await createServiceClient()

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

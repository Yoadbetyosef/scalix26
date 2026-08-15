import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { primaryAgent } from '@/lib/agents/primary'
import { looksLikeName } from '@/lib/utils'
import { recapAfterResponse } from '@/lib/conversations/recap'
import { stopDripsForPhone } from '@/lib/leads/drip'

type TranscriptItem = { role?: string; content?: string }

// Persist a finished Deepgram voice call as an Inbox conversation + transcript.
// Tenant is resolved from the secret lead token (same pattern as the other
// voice-server endpoints) so it can't be spoofed with a tenant_id in the body.
export async function POST(req: NextRequest) {
  const data = (await req.json().catch(() => ({}))) as {
    lead_token?: unknown
    contact_phone?: unknown
    contact_name?: unknown
    transcript?: unknown
    duration_seconds?: unknown
  }

  const leadToken = typeof data.lead_token === 'string' ? data.lead_token : undefined
  const phone = typeof data.contact_phone === 'string' ? data.contact_phone : undefined
  // The voice-server's name heuristic can capture a whole garbled utterance ("Did I
  // call John Oreo add?"). Only keep it if it actually looks like a name — otherwise
  // store null so junk never reaches contacts.name (which is the inbox title).
  const rawName = typeof data.contact_name === 'string' && data.contact_name.trim() ? data.contact_name.trim() : null
  const name = looksLikeName(rawName) ? rawName : null
  const durationSeconds = typeof data.duration_seconds === 'number' ? data.duration_seconds : null
  const transcript: TranscriptItem[] = Array.isArray(data.transcript) ? (data.transcript as TranscriptItem[]) : []

  if (!leadToken) return NextResponse.json({ error: 'lead_token required' }, { status: 400 })

  const turns = transcript.filter((m) => m && typeof m.content === 'string' && m.content.trim())
  if (turns.length === 0) return NextResponse.json({ ok: true, skipped: 'empty_transcript' })

  const supabase = await createServiceClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('lead_intake_token', leadToken)
    .maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'invalid token' }, { status: 404 })
  const tenantId = tenant.id

  // Also not in the original mapping: same unbounded maybeSingle(), and a null here writes a
  // conversation with no agent attached rather than failing loudly.
  const agent = await primaryAgent<{ id: string }>(supabase, tenantId, 'id')

  // Find or create the contact by phone + tenant.
  let contactId: string | null = null
  if (phone) {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('phone', phone)
      .maybeSingle()
    if (existing) {
      contactId = existing.id
      if (name) await supabase.from('contacts').update({ name }).eq('id', contactId).is('name', null)
    } else {
      const { data: created } = await supabase
        .from('contacts')
        .insert({ tenant_id: tenantId, phone, name, channel: 'voice' })
        .select('id')
        .single()
      contactId = created?.id ?? null
    }
  }

  // Create the conversation (resolved — the call is over).
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .insert({
      tenant_id: tenantId,
      ai_employee_id: agent?.id ?? null,
      contact_id: contactId,
      channel: 'voice',
      status: 'resolved',
      duration_seconds: durationSeconds,
    })
    .select('id')
    .single()
  if (convErr || !conv) {
    return NextResponse.json({ error: convErr?.message || 'failed_to_create_conversation' }, { status: 500 })
  }

  // Save the transcript as messages, timestamped in order across the call window.
  const now = Date.now()
  const rows = turns.map((m, i) => ({
    conversation_id: conv.id,
    tenant_id: tenantId,
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: (m.content as string).trim(),
    channel: 'voice',
    timestamp: new Date(now - (turns.length - i) * 1000).toISOString(),
  }))
  await supabase.from('messages').insert(rows)

  // A CALLER WHO TALKED HAS ANSWERED. A missed-call lead's whole sequence says "sorry we missed you,
  // reply YES" — chasing that after they rang back and had a conversation is the same wrong as
  // chasing a customer who texted. This route only runs on a non-empty transcript (see the guard
  // above), so a ring-out or a wrong number that never spoke does not cancel anything.
  await stopDripsForPhone(supabase, tenantId, phone, 'answered call')

  // The call is over — this row is inserted `resolved` — so this is where the recap gets written.
  // After the response: the voice server is waiting on this, and a recap must never hold it up.
  recapAfterResponse(conv.id, tenantId)

  return NextResponse.json({ ok: true, conversation_id: conv.id, messages: rows.length })
}

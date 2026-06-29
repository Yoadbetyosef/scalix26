import type { SupabaseClient } from '@supabase/supabase-js'
import type { InteractionUnit } from './types'

export interface Harvest {
  units: InteractionUnit[]
  leads: { status: string; source: string | null; created_at: string; responded_at: string | null }[]
  appointments: { status: string; slot_date: string | null; created_at: string }[]
  sources: string[]
  counts: { conversations: number; messages: number; leads: number; appointments: number }
}

// Read-only harvest of an interaction window from the data the channels ALREADY persist.
// Incremental via `since` (a watermark). Strictly tenant-scoped. Touches no live pipeline.
export async function harvestTenant(
  admin: SupabaseClient,
  tenantId: string,
  opts: { agentId?: string | null; since?: string | null; limit?: number } = {},
): Promise<Harvest> {
  const limit = opts.limit ?? 80
  const sources: string[] = []

  let convQ = admin
    .from('conversations')
    .select('id, channel, human_takeover, sentiment, summary, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (opts.agentId) convQ = convQ.or(`ai_employee_id.eq.${opts.agentId},ai_employee_id.is.null`)
  if (opts.since) convQ = convQ.gte('updated_at', opts.since)
  const { data: convs } = await convQ
  if (convs?.length) sources.push('conversations')

  const convIds = (convs || []).map((c) => c.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let msgs: any[] = []
  if (convIds.length) {
    const { data } = await admin
      .from('messages')
      .select('conversation_id, role, content, timestamp')
      .in('conversation_id', convIds)
      .order('timestamp', { ascending: true })
      .limit(3000)
    msgs = data || []
    if (msgs.length) sources.push('messages / transcripts')
  }

  const byConv = new Map<string, { role: string; content: string; timestamp: string }[]>()
  for (const m of msgs) {
    const arr = byConv.get(m.conversation_id) || []
    arr.push({ role: m.role, content: String(m.content || ''), timestamp: m.timestamp })
    byConv.set(m.conversation_id, arr)
  }

  const units: InteractionUnit[] = (convs || []).map((c) => ({
    conversation_id: c.id,
    channel: c.channel,
    human_takeover: !!c.human_takeover,
    sentiment: c.sentiment ?? null,
    summary: c.summary ?? null,
    created_at: c.created_at,
    messages: byConv.get(c.id) || [],
  }))

  let leadsQ = admin
    .from('leads')
    .select('status, source, created_at, responded_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (opts.since) leadsQ = leadsQ.gte('created_at', opts.since)
  const { data: leads } = await leadsQ
  if (leads?.length) sources.push('leads / outcomes')

  let apptQ = admin
    .from('appointments')
    .select('status, slot_date, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (opts.since) apptQ = apptQ.gte('created_at', opts.since)
  const { data: appts } = await apptQ
  if (appts?.length) sources.push('appointments')

  return {
    units,
    leads: leads || [],
    appointments: appts || [],
    sources,
    counts: {
      conversations: units.length,
      messages: msgs.length,
      leads: (leads || []).length,
      appointments: (appts || []).length,
    },
  }
}

import { createAdminClient } from '@/lib/supabase/server'
import { formatTime12 } from '@/lib/appointments'

export interface TimelineEvent {
  at: string
  kind: 'inbound' | 'outbound' | 'lead' | 'appointment' | 'followup'
  text?: string
  label?: string
}

function truncate(s: string, n = 140): string { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s }
function phoneKey(p?: string | null): string { return (p || '').replace(/\D/g, '').slice(-10) }

// Build a conversation's real event timeline: every stored message + real milestone
// records (lead created, appointment created, follow-up sent). ONLY real records with
// their actual timestamps — no synthesized steps, no fabricated gaps. Tenant-scoped:
// the conversation must belong to the caller's tenant (verified before reading).
export async function getConversationTimeline(tenantId: string, conversationId: string): Promise<TimelineEvent[]> {
  const supabase = createAdminClient()
  const { data: conv } = await supabase
    .from('conversations').select('id, contact_id, created_at')
    .eq('id', conversationId).eq('tenant_id', tenantId).maybeSingle()
  if (!conv) return [] // not found / not this tenant → nothing (no cross-tenant read)

  const [{ data: msgs }, { data: contact }] = await Promise.all([
    supabase.from('messages').select('role, content, timestamp').eq('conversation_id', conversationId).eq('tenant_id', tenantId).order('timestamp', { ascending: true }).limit(100),
    conv.contact_id ? supabase.from('contacts').select('phone').eq('id', conv.contact_id).maybeSingle() : Promise.resolve({ data: null as { phone: string | null } | null }),
  ])

  const events: TimelineEvent[] = []
  for (const m of msgs || []) {
    events.push({ at: m.timestamp, kind: m.role === 'user' ? 'inbound' : 'outbound', text: truncate(m.content || '') })
  }

  if (conv.contact_id) {
    const convMs = +new Date(conv.created_at)
    const [{ data: leads }, { data: appts }, { data: drips }] = await Promise.all([
      supabase.from('leads').select('created_at').eq('tenant_id', tenantId).eq('contact_id', conv.contact_id),
      supabase.from('appointments').select('created_at, slot_date, slot_time').eq('tenant_id', tenantId).eq('contact_id', conv.contact_id),
      supabase.from('drip_campaigns').select('contact_phone, messages_sent, created_at').eq('tenant_id', tenantId),
    ])
    for (const l of leads || []) if (+new Date(l.created_at) >= convMs) events.push({ at: l.created_at, kind: 'lead', label: 'Lead captured' })
    for (const a of appts || []) if (+new Date(a.created_at) >= convMs) {
      const when = a.slot_date ? ` — ${a.slot_date}${a.slot_time ? ` ${formatTime12(String(a.slot_time))}` : ''}` : ''
      events.push({ at: a.created_at, kind: 'appointment', label: `Appointment scheduled${when}` })
    }
    const ck = phoneKey(contact?.phone)
    if (ck) for (const d of drips || []) {
      if ((d.messages_sent || 0) > 0 && phoneKey(d.contact_phone) === ck && +new Date(d.created_at) >= convMs) {
        events.push({ at: d.created_at, kind: 'followup', label: 'Follow-up sent' })
      }
    }
  }

  events.sort((a, b) => +new Date(a.at) - +new Date(b.at))
  return events
}

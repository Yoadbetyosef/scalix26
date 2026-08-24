import { createAdminClient } from '@/lib/supabase/server'
import {
  loadImpactBase, currentMonthWindow, afterHoursForConv,
  selectConversationsManaged, selectOpportunities, selectCustomersAssisted,
  selectCoverageInbound, selectTakeoverOpen, selectLeadsNoFollowup,
  type DrilldownMetric, type Conv, type LeadRow, type ImpactBase,
} from './impact'

export type TagTone = 'green' | 'blue' | 'purple' | 'indigo' | 'amber' | 'gray'
export interface OutcomeTag { label: string; tone: TagTone }

export interface ProofRow {
  id: string
  kind: 'conversation' | 'lead'
  name: string
  channel: string | null
  createdAt: string
  summary: string
  href: string
  pills: OutcomeTag[]            // specific outcomes, strongest first (may be several)
  ownerTimeSaved: boolean        // Scalix responded AND no human takeover → green block
  statusKind: 'saved' | 'takeover' | 'no_response'
}

export interface DrilldownResult { total: number; rows: ProofRow[]; hasMore: boolean; scoreboard: string[] }

function maskName(c?: { name?: string | null; phone?: string | null; email?: string | null }): string {
  if (c?.name && c.name.trim()) return c.name.trim()
  if (c?.phone) return c.phone.length > 4 ? `•••• ${c.phone.slice(-4)}` : c.phone
  if (c?.email) { const [u, d] = c.email.split('@'); return d ? `${u.slice(0, 2)}•••@${d}` : c.email }
  return 'Customer'
}
function truncate(s: string, n = 120): string { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s }
function phoneKey(p?: string | null): string { return (p || '').replace(/\D/g, '').slice(-10) }

type DripRec = { messagesSent: number; updatedMs: number }

export async function getDrilldownRows(tenantId: string, metric: DrilldownMetric, offset: number, limit: number): Promise<DrilldownResult> {
  const base = await loadImpactBase(tenantId)
  const { start, end } = currentMonthWindow()

  // Lead-shaped metric.
  if (metric === 'attention_leads') {
    const leads = selectLeadsNoFollowup(base)
    const page = leads.slice(offset, offset + limit)
    const rows: ProofRow[] = page.map((l: LeadRow) => ({
      id: l.id, kind: 'lead', name: maskName({ name: l.name, phone: l.phone }), channel: 'lead', createdAt: l.created_at,
      // A lead with no contact row has nowhere of its own to go now that the Leads tab is gone;
      // the contact list is the nearest true destination.
      summary: '', href: l.contact_id ? `/contacts/${l.contact_id}` : '/contacts',
      pills: [{ label: 'Lead Captured', tone: 'blue' }], ownerTimeSaved: false, statusKind: 'no_response',
    }))
    return { total: leads.length, rows, hasMore: offset + limit < leads.length, scoreboard: [`${leads.length} ${leads.length === 1 ? 'lead' : 'leads'} awaiting follow-up`] }
  }

  // Conversation-shaped metrics.
  let convList: Conv[] = []
  let respondedSet: Set<string> | null = null
  switch (metric) {
    case 'customers_assisted': convList = selectCustomersAssisted(base, start, end); break
    case 'opportunities': convList = selectOpportunities(base, start, end); break
    case 'conversations_managed': convList = selectConversationsManaged(base, start, end); break
    case 'coverage': { const c = selectCoverageInbound(base, start, end); convList = c.rows; respondedSet = c.respondedSet; break }
    case 'attention_takeover': convList = selectTakeoverOpen(base); break
    default: convList = []
  }
  const total = convList.length

  // Tenant-wide structured-outcome maps (small; used for tags + scoreboard).
  const supabase = createAdminClient()
  const [{ data: allAppts }, { data: allDrips }] = await Promise.all([
    supabase.from('appointments').select('contact_id, created_at, slot_date').eq('tenant_id', tenantId),
    supabase.from('drip_campaigns').select('contact_phone, messages_sent, updated_at').eq('tenant_id', tenantId),
  ])
  const apptByContact = new Map<string, number[]>()
  for (const a of allAppts || []) { if (!a.contact_id) continue; const arr = apptByContact.get(a.contact_id) ?? []; arr.push(+new Date(a.created_at)); apptByContact.set(a.contact_id, arr) }
  const leadByContact = new Map<string, number[]>()
  for (const l of base.leads) { if (!l.contact_id) continue; const arr = leadByContact.get(l.contact_id) ?? []; arr.push(+new Date(l.created_at)); leadByContact.set(l.contact_id, arr) }
  const dripByPhone = new Map<string, DripRec[]>()
  for (const d of allDrips || []) { const k = phoneKey(d.contact_phone); if (!k) continue; const arr = dripByPhone.get(k) ?? []; arr.push({ messagesSent: d.messages_sent || 0, updatedMs: +new Date(d.updated_at) }); dripByPhone.set(k, arr) }

  // ── Scoreboard: real aggregates over the FULL set for this view (omit 0) ──────
  const sbCustomers = new Set(convList.filter((c) => base.respondedEver.has(c.id)).map((c) => c.contact_id).filter(Boolean)).size
  const sbAfter = convList.filter((c) => afterHoursForConv(base, c)).length
  const sbTakeover = convList.filter((c) => c.human_takeover === true).length
  const sbAppt = new Set(convList.filter((c) => c.contact_id && (apptByContact.get(c.contact_id) || []).length).map((c) => c.contact_id)).size
  const sbLead = new Set(convList.filter((c) => c.contact_id && (leadByContact.get(c.contact_id) || []).length).map((c) => c.contact_id)).size
  const scoreboard = [
    `${total} ${total === 1 ? 'conversation' : 'conversations'} handled`,
    sbCustomers > 0 ? `${sbCustomers} ${sbCustomers === 1 ? 'customer' : 'customers'} assisted` : '',
    sbAfter > 0 ? `${sbAfter} after-hours ${sbAfter === 1 ? 'response' : 'responses'}` : '',
    sbAppt > 0 ? `${sbAppt} ${sbAppt === 1 ? 'appointment' : 'appointments'} scheduled` : '',
    sbLead > 0 ? `${sbLead} ${sbLead === 1 ? 'lead' : 'leads'} captured` : '',
    sbTakeover > 0 ? `${sbTakeover} required you` : '',
  ].filter(Boolean)

  const page = convList.slice(offset, offset + limit)
  if (page.length === 0) return { total, rows: [], hasMore: false, scoreboard }

  // Enrich ONLY the page (batched): contact names + the conversation's inbound msgs.
  const contactIds = [...new Set(page.map((c) => c.contact_id).filter((x): x is string => !!x))]
  const convIds = page.map((c) => c.id)
  const [{ data: contacts }, { data: msgs }] = await Promise.all([
    contactIds.length ? supabase.from('contacts').select('id, name, phone, email').in('id', contactIds) : Promise.resolve({ data: [] as { id: string; name: string | null; phone: string | null; email: string | null }[] }),
    supabase.from('messages').select('conversation_id, content, timestamp').in('conversation_id', convIds).eq('role', 'user').order('timestamp', { ascending: true }),
  ])
  const contactById = new Map((contacts || []).map((c) => [c.id, c]))
  const firstInbound = new Map<string, string>()
  const inboundTimes = new Map<string, number[]>()
  for (const m of msgs || []) {
    if (!m.conversation_id) continue
    if (!firstInbound.has(m.conversation_id)) firstInbound.set(m.conversation_id, m.content || '')
    const arr = inboundTimes.get(m.conversation_id) ?? []; arr.push(+new Date(m.timestamp)); inboundTimes.set(m.conversation_id, arr)
  }

  const rows: ProofRow[] = page.map((c) => {
    const contact = c.contact_id ? contactById.get(c.contact_id) : undefined
    const convMs = +new Date(c.created_at)
    const responded = base.respondedEver.has(c.id)
    const drips = (dripByPhone.get(phoneKey(contact?.phone)) || []).filter((d) => d.messagesSent > 0)
    const followUpSent = drips.length > 0
    const reEngaged = followUpSent && (inboundTimes.get(c.id) || []).some((t) => drips.some((d) => t > d.updatedMs))

    // Pills — strongest first; Re-engaged supersedes the plain Follow-Up Sent pill.
    const pills: OutcomeTag[] = []
    if (c.contact_id && (apptByContact.get(c.contact_id) || []).some((t) => t >= convMs)) pills.push({ label: 'Appointment Scheduled', tone: 'green' })
    if (c.contact_id && (leadByContact.get(c.contact_id) || []).some((t) => t >= convMs)) pills.push({ label: 'Lead Captured', tone: 'blue' })
    if (reEngaged) pills.push({ label: 'Customer Re-engaged', tone: 'purple' })
    else if (followUpSent) pills.push({ label: 'Follow-Up Sent', tone: 'indigo' })
    if (afterHoursForConv(base, c)) pills.push({ label: 'After-Hours Response', tone: 'amber' })

    const ownerTimeSaved = responded && c.human_takeover !== true
    const statusKind: ProofRow['statusKind'] = c.human_takeover === true ? 'takeover' : responded ? 'saved' : 'no_response'

    return {
      id: c.id, kind: 'conversation', name: maskName(contact), channel: c.channel, createdAt: c.created_at,
      summary: truncate(firstInbound.get(c.id) || ''), href: `/inbox/${c.id}`,
      pills, ownerTimeSaved, statusKind,
    }
  })

  return { total, rows, hasMore: offset + limit < total, scoreboard }
}

// Re-export so callers keep one import surface.
export type { ImpactBase }

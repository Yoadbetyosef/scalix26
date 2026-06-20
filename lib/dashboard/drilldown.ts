import { createAdminClient } from '@/lib/supabase/server'
import {
  loadImpactBase, currentMonthWindow, afterHoursForConv,
  selectConversationsManaged, selectOpportunities, selectCustomersAssisted,
  selectCoverageInbound, selectTakeoverOpen, selectLeadsNoFollowup,
  type DrilldownMetric, type Conv, type LeadRow, type ImpactBase,
} from './impact'

export type TagTone = 'green' | 'blue' | 'indigo' | 'teal' | 'gray'
export interface OutcomeTag { label: string; tone: TagTone }

export interface ProofRow {
  id: string
  kind: 'conversation' | 'lead'
  name: string
  channel: string | null
  createdAt: string
  statusKey: 'responded' | 'takeover' | 'no_response' | 'awaiting_followup'
  summary: string
  href: string
  tags: OutcomeTag[]       // outcome tags proven from structured data (may be multiple)
  impactLines: string[]    // provable impact context (no timing claims)
}

export interface DrilldownResult { total: number; rows: ProofRow[]; hasMore: boolean }

function maskName(c?: { name?: string | null; phone?: string | null; email?: string | null }): string {
  if (c?.name && c.name.trim()) return c.name.trim()
  if (c?.phone) return c.phone.length > 4 ? `•••• ${c.phone.slice(-4)}` : c.phone
  if (c?.email) { const [u, d] = c.email.split('@'); return d ? `${u.slice(0, 2)}•••@${d}` : c.email }
  return 'Customer'
}
function truncate(s: string, n = 120): string { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s }

// Build a conversation proof row INCLUDING outcome tags + impact lines. Every tag is
// proven from STRUCTURED data only (appointment/lead linkage, business-hours, the
// existence of an outbound message, human_takeover) — never from message content or
// response timing. A row may carry multiple true tags.
function computeRow(
  base: ImpactBase,
  c: Conv,
  respondedSet: Set<string> | null,
  contactById: Map<string, { name: string | null; phone: string | null; email: string | null }>,
  firstInbound: Map<string, string>,
  apptByContact: Map<string, number[]>,
  leadByContact: Map<string, number[]>,
): ProofRow {
  const convMs = +new Date(c.created_at)
  const responded = base.respondedEver.has(c.id)
  const afterHours = afterHoursForConv(base, c)

  const tags: OutcomeTag[] = []
  // Appointment booked for this contact at/after the conversation started.
  if (c.contact_id && (apptByContact.get(c.contact_id) || []).some((t) => t >= convMs)) tags.push({ label: 'Appointment Scheduled', tone: 'green' })
  // Lead record created for this contact at/after the conversation started.
  if (c.contact_id && (leadByContact.get(c.contact_id) || []).some((t) => t >= convMs)) tags.push({ label: 'Lead Captured', tone: 'blue' })
  // Started outside the agent's business hours.
  if (afterHours) tags.push({ label: 'After-Hours Response', tone: 'indigo' })
  // Scalix responded and the owner never had to step in.
  if (responded && c.human_takeover !== true) tags.push({ label: 'Handled Automatically', tone: 'teal' })
  // Fallback: responded, but none of the structured outcomes above applied.
  if (responded && tags.length === 0) tags.push({ label: 'Customer Assisted', tone: 'gray' })

  const impactLines: string[] = []
  if (c.human_takeover !== true) impactLines.push('No owner involvement required')
  if (responded && c.human_takeover !== true) impactLines.push('Handled automatically by Scalix')

  const statusKey: ProofRow['statusKey'] = respondedSet
    ? (respondedSet.has(c.id) ? 'responded' : 'no_response')
    : c.human_takeover === true ? 'takeover' : responded ? 'responded' : 'no_response'

  return {
    id: c.id,
    kind: 'conversation',
    name: maskName(c.contact_id ? contactById.get(c.contact_id) : undefined),
    channel: c.channel,
    createdAt: c.created_at,
    statusKey,
    summary: truncate(firstInbound.get(c.id) || ''),
    href: `/inbox/${c.id}`,
    tags,
    impactLines,
  }
}

// Returns the EXACT records behind a metric, using the same selectors that produced
// the card count. Read-only; caller must have already verified tenant ownership.
export async function getDrilldownRows(tenantId: string, metric: DrilldownMetric, offset: number, limit: number): Promise<DrilldownResult> {
  const base = await loadImpactBase(tenantId)
  const { start, end } = currentMonthWindow()

  // Lead-shaped metric.
  if (metric === 'attention_leads') {
    const leads = selectLeadsNoFollowup(base)
    const page = leads.slice(offset, offset + limit)
    const rows: ProofRow[] = page.map((l: LeadRow) => ({
      id: l.id,
      kind: 'lead',
      name: maskName({ name: l.name, phone: l.phone }),
      channel: 'lead',
      createdAt: l.created_at,
      statusKey: 'awaiting_followup',
      summary: '',
      href: l.contact_id ? `/contacts/${l.contact_id}` : '/dashboard?tab=leads',
      tags: [{ label: 'Lead Captured', tone: 'blue' }],
      impactLines: [],
    }))
    return { total: leads.length, rows, hasMore: offset + limit < leads.length }
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
  const page = convList.slice(offset, offset + limit)
  if (page.length === 0) return { total, rows: [], hasMore: false }

  // Enrich ONLY the page (batched — no N+1): contact names, first inbound message,
  // and the appointment links used for the "Appointment Scheduled" outcome tag.
  const supabase = createAdminClient()
  const contactIds = [...new Set(page.map((c) => c.contact_id).filter((x): x is string => !!x))]
  const convIds = page.map((c) => c.id)
  const [{ data: contacts }, { data: msgs }, { data: appts }] = await Promise.all([
    contactIds.length ? supabase.from('contacts').select('id, name, phone, email').in('id', contactIds) : Promise.resolve({ data: [] as { id: string; name: string | null; phone: string | null; email: string | null }[] }),
    supabase.from('messages').select('conversation_id, content, timestamp').in('conversation_id', convIds).eq('role', 'user').order('timestamp', { ascending: true }),
    contactIds.length ? supabase.from('appointments').select('contact_id, created_at').in('contact_id', contactIds) : Promise.resolve({ data: [] as { contact_id: string | null; created_at: string }[] }),
  ])
  const contactById = new Map((contacts || []).map((c) => [c.id, c]))
  const firstInbound = new Map<string, string>()
  for (const m of msgs || []) if (m.conversation_id && !firstInbound.has(m.conversation_id)) firstInbound.set(m.conversation_id, m.content || '')

  // Batched structured-outcome maps: contact_id -> created_at (ms) of appointments / leads.
  const apptByContact = new Map<string, number[]>()
  for (const a of appts || []) {
    if (!a.contact_id) continue
    const arr = apptByContact.get(a.contact_id) ?? []
    arr.push(+new Date(a.created_at)); apptByContact.set(a.contact_id, arr)
  }
  const leadByContact = new Map<string, number[]>()
  for (const l of base.leads) {
    if (!l.contact_id) continue
    const arr = leadByContact.get(l.contact_id) ?? []
    arr.push(+new Date(l.created_at)); leadByContact.set(l.contact_id, arr)
  }

  const rows: ProofRow[] = page.map((c) => computeRow(base, c, respondedSet, contactById, firstInbound, apptByContact, leadByContact))
  return { total, rows, hasMore: offset + limit < total }
}

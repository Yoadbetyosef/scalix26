import { createAdminClient } from '@/lib/supabase/server'
import {
  loadImpactBase, currentMonthWindow,
  selectConversationsManaged, selectOpportunities, selectCustomersAssisted,
  selectCoverageInbound, selectTakeoverOpen, selectLeadsNoFollowup,
  type DrilldownMetric, type Conv, type LeadRow,
} from './impact'

export interface ProofRow {
  id: string
  kind: 'conversation' | 'lead'
  name: string
  channel: string | null
  createdAt: string
  statusKey: 'responded' | 'takeover' | 'no_response' | 'awaiting_followup'
  summary: string
  href: string
}

export interface DrilldownResult { total: number; rows: ProofRow[]; hasMore: boolean }

function maskName(c?: { name?: string | null; phone?: string | null; email?: string | null }): string {
  if (c?.name && c.name.trim()) return c.name.trim()
  if (c?.phone) return c.phone.length > 4 ? `•••• ${c.phone.slice(-4)}` : c.phone
  if (c?.email) { const [u, d] = c.email.split('@'); return d ? `${u.slice(0, 2)}•••@${d}` : c.email }
  return 'Customer'
}
function truncate(s: string, n = 120): string { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s }

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

  // Enrich ONLY the page: contact names + the first inbound customer message.
  const supabase = createAdminClient()
  const contactIds = [...new Set(page.map((c) => c.contact_id).filter((x): x is string => !!x))]
  const convIds = page.map((c) => c.id)
  const [{ data: contacts }, { data: msgs }] = await Promise.all([
    contactIds.length ? supabase.from('contacts').select('id, name, phone, email').in('id', contactIds) : Promise.resolve({ data: [] as { id: string; name: string | null; phone: string | null; email: string | null }[] }),
    supabase.from('messages').select('conversation_id, content, timestamp').in('conversation_id', convIds).eq('role', 'user').order('timestamp', { ascending: true }),
  ])
  const contactById = new Map((contacts || []).map((c) => [c.id, c]))
  const firstInbound = new Map<string, string>()
  for (const m of msgs || []) if (m.conversation_id && !firstInbound.has(m.conversation_id)) firstInbound.set(m.conversation_id, m.content || '')

  const rows: ProofRow[] = page.map((c) => {
    const statusKey: ProofRow['statusKey'] = respondedSet
      ? (respondedSet.has(c.id) ? 'responded' : 'no_response')
      : c.human_takeover === true ? 'takeover' : base.respondedEver.has(c.id) ? 'responded' : 'no_response'
    return {
      id: c.id,
      kind: 'conversation',
      name: maskName(c.contact_id ? contactById.get(c.contact_id) : undefined),
      channel: c.channel,
      createdAt: c.created_at,
      statusKey,
      summary: truncate(firstInbound.get(c.id) || ''),
      href: `/inbox/${c.id}`,
    }
  })

  return { total, rows, hasMore: offset + limit < total }
}

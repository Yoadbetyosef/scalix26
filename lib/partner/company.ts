import { createAdminClient } from '@/lib/supabase/server'
import { getPartnerClients } from '@/lib/partner/economics-resolve'
import { computeWholesaleSummary } from '@/lib/partner/wholesale'

// Read-only presentation aggregations for the White Label "company" experience (HQ + Businesses).
// Everything is framed as the OWNER's own AI software company — no wholesale/cost/reseller concepts leak
// out of here. Costs are never returned; only the owner's revenue, profit, activity, and health.

export interface BusinessCard {
  id: string
  tenantId: string | null
  name: string
  planLabel: string | null
  mrrCents: number
  status: string
  aiCount: number
  lastActivity: string | null
  weekMessages: number
  spark: number[]
  setupComplete: boolean
  needsAttention: boolean
  inviteStatus: string // 'none' | draft|sent|pending|accepted|expired|revoked
  ownerLinked: boolean // tenant.user_id is set (the client owner has accepted + can log in)
}

export interface CompanyOverview {
  businessCount: number
  activeCount: number
  mrrCents: number
  profitCents: number
  mrrDeltaCents: number
  newThisMonth: number
  aiEmployeeCount: number
  healthyPct: number
  today: { messages: number; calls: number; bookings: number; leads: number }
  recent: { kind: 'business' | 'booking' | 'volume'; text: string; at: string }[]
  attention: { tenantId: string | null; name: string; reason: string }[]
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()
const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString() }
const titleCase = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : null)

// Bucket a list of ISO timestamps into a 7-slot day histogram (oldest → newest) for a sparkline.
function spark7(timestamps: string[]): number[] {
  const buckets = [0, 0, 0, 0, 0, 0, 0]
  const now = Date.now()
  for (const ts of timestamps) {
    const dayIdx = 6 - Math.floor((now - new Date(ts).getTime()) / 86400000)
    if (dayIdx >= 0 && dayIdx <= 6) buckets[dayIdx]++
  }
  return buckets
}

// The Businesses grid — one enriched card per business the partner owns.
export async function getBusinesses(partnerId: string): Promise<BusinessCard[]> {
  const clients = await getPartnerClients(partnerId)
  const ids = clients.map((c) => c.tenant_id).filter((t): t is string => !!t)
  const db = createAdminClient()

  const [ai, msgs, convs, invites, tenantRows] = ids.length
    ? await Promise.all([
        db.from('ai_employees').select('tenant_id, status, setup_complete').in('tenant_id', ids),
        db.from('messages').select('tenant_id, created_at').in('tenant_id', ids).gte('created_at', daysAgo(7)).limit(20000),
        db.from('conversations').select('tenant_id, updated_at').in('tenant_id', ids).order('updated_at', { ascending: false }).limit(3000),
        // Tolerant of the pre-migration state: if business_invites doesn't exist yet, treat as no invites.
        db.from('business_invites').select('tenant_id, status, accepted_at, expires_at').in('tenant_id', ids).then((r) => r, () => ({ data: [] })),
        db.from('tenants').select('id, user_id').in('id', ids),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }]

  const inviteByTenant = new Map<string, string>()
  for (const r of ((invites as { data?: unknown[] }).data || []) as { tenant_id: string; status: string; accepted_at: string | null; expires_at: string }[]) {
    const eff = r.status === 'accepted' ? 'accepted' : r.status === 'revoked' ? 'revoked'
      : (!r.accepted_at && new Date(r.expires_at).getTime() < Date.now()) ? 'expired' : r.status
    inviteByTenant.set(r.tenant_id, eff)
  }
  const ownerLinked = new Map<string, boolean>()
  for (const r of ((tenantRows as { data?: unknown[] }).data || []) as { id: string; user_id: string | null }[]) ownerLinked.set(r.id, !!r.user_id)

  const aiByTenant = new Map<string, { count: number; setupComplete: boolean }>()
  for (const r of (ai.data || []) as { tenant_id: string; setup_complete: boolean | null }[]) {
    const cur = aiByTenant.get(r.tenant_id) || { count: 0, setupComplete: false }
    cur.count++
    if (r.setup_complete) cur.setupComplete = true
    aiByTenant.set(r.tenant_id, cur)
  }
  const msgByTenant = new Map<string, string[]>()
  for (const r of (msgs.data || []) as { tenant_id: string; created_at: string }[]) {
    const arr = msgByTenant.get(r.tenant_id) || []
    arr.push(r.created_at)
    msgByTenant.set(r.tenant_id, arr)
  }
  const lastByTenant = new Map<string, string>()
  for (const r of (convs.data || []) as { tenant_id: string; updated_at: string }[]) {
    if (!lastByTenant.has(r.tenant_id)) lastByTenant.set(r.tenant_id, r.updated_at)
  }

  return clients.map((c) => {
    const t = c.tenant_id || ''
    const aiInfo = aiByTenant.get(t) || { count: 0, setupComplete: false }
    const tsList = msgByTenant.get(t) || []
    const setupComplete = aiInfo.setupComplete || (c.status === 'active' && aiInfo.count > 0)
    return {
      id: c.id,
      tenantId: c.tenant_id,
      name: c.business_name || 'Business',
      planLabel: titleCase(c.plan_code),
      mrrCents: c.retail_price_cents || 0,
      status: c.status,
      aiCount: aiInfo.count,
      lastActivity: lastByTenant.get(t) || null,
      weekMessages: tsList.length,
      spark: spark7(tsList),
      setupComplete,
      needsAttention: !setupComplete,
      inviteStatus: inviteByTenant.get(t) || 'none',
      ownerLinked: ownerLinked.get(t) || false,
    }
  })
}

// The Company HQ overview — revenue-forward. Costs are intentionally NOT surfaced.
export async function getCompanyOverview(partnerId: string): Promise<CompanyOverview> {
  const clients = await getPartnerClients(partnerId)
  const summary = computeWholesaleSummary(clients)
  const ids = clients.map((c) => c.tenant_id).filter((t): t is string => !!t)
  const db = createAdminClient()
  const today = startOfToday()

  const [aiRes, msgToday, callsToday, bookToday, leadsToday, recentAppts] = ids.length
    ? await Promise.all([
        db.from('ai_employees').select('tenant_id, status, setup_complete').in('tenant_id', ids),
        db.from('messages').select('id', { count: 'exact', head: true }).in('tenant_id', ids).gte('created_at', today),
        db.from('analytics_events').select('id', { count: 'exact', head: true }).in('tenant_id', ids).eq('event_type', 'message_handled').eq('data->>channel', 'voice').gte('created_at', today),
        db.from('appointments').select('id', { count: 'exact', head: true }).in('tenant_id', ids).gte('created_at', today),
        db.from('leads').select('id', { count: 'exact', head: true }).in('tenant_id', ids).gte('created_at', today),
        db.from('appointments').select('tenant_id, customer_name, created_at').in('tenant_id', ids).order('created_at', { ascending: false }).limit(5),
      ])
    : [{ data: [] }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { data: [] }]

  const aiRows = (aiRes.data || []) as { tenant_id: string; status: string | null; setup_complete: boolean | null }[]
  const aiCount = aiRows.length
  const activeAi = aiRows.filter((r) => r.status === 'active').length
  const healthyPct = aiCount ? Math.round((activeAi / aiCount) * 100) : 100

  const nameByTenant = new Map(clients.map((c) => [c.tenant_id, c.business_name || 'Business']))
  const monthStart = startOfMonth()
  const mrrDeltaCents = clients.filter((c) => c.status === 'active' && c.created_at >= monthStart).reduce((a, c) => a + (c.retail_price_cents || 0), 0)

  // Recent activity feed — newest businesses + newest bookings, merged by time.
  const recent: CompanyOverview['recent'] = []
  for (const c of clients.filter((c) => c.created_at >= daysAgo(30)).slice(0, 5)) {
    recent.push({ kind: 'business', text: `New business · ${c.business_name || 'Business'}`, at: c.created_at })
  }
  for (const a of (recentAppts.data || []) as { tenant_id: string; customer_name: string | null; created_at: string }[]) {
    recent.push({ kind: 'booking', text: `${nameByTenant.get(a.tenant_id) || 'A business'} booked ${a.customer_name || 'an appointment'}`, at: a.created_at })
  }
  recent.sort((a, b) => (a.at < b.at ? 1 : -1))

  // Needs attention — businesses whose AI setup isn't finished.
  const setupByTenant = new Map<string, boolean>()
  for (const r of aiRows) { if (r.setup_complete) setupByTenant.set(r.tenant_id, true) }
  const attention = clients
    .filter((c) => c.status === 'active' && c.tenant_id && !setupByTenant.get(c.tenant_id))
    .slice(0, 5)
    .map((c) => ({ tenantId: c.tenant_id, name: c.business_name || 'Business', reason: 'AI setup incomplete' }))

  return {
    businessCount: summary.total_clients,
    activeCount: summary.active_clients,
    mrrCents: summary.monthly_retail_cents,
    profitCents: summary.gross_profit_cents,
    mrrDeltaCents,
    newThisMonth: summary.new_this_month,
    aiEmployeeCount: aiCount,
    healthyPct,
    today: {
      messages: msgToday.count || 0,
      calls: callsToday.count || 0,
      bookings: bookToday.count || 0,
      leads: leadsToday.count || 0,
    },
    recent: recent.slice(0, 6),
    attention,
  }
}

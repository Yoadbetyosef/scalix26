import { createAdminClient } from '@/lib/supabase/server'
import { XP, levelForXp } from '@/lib/partner/xp'
import type { PartnerStatsFull } from '@/lib/partner/stats'
import type { PartnerModuleKey } from '@/lib/partner/modules'

// Assembles the partner "Business Operating System" model: Today's Focus, money left on the table,
// a multi-factor health score, forecasts, goals, top channel, grouped missions, data-fed alerts, a
// live activity feed (incl. ecosystem wins), and state-aware quick actions. Deterministic now (the
// AI Business Manager prioritizes later); all derived from existing tables. Read-only.

export interface FocusItem { icon: string; title: string; cta: string; href: string; tone: 'action' | 'tip' }
export interface Mission { label: string; current: number; target: number; xp: number; href: string }
export interface GroupedMissions { daily: Mission[]; weekly: Mission[]; monthly: Mission[]; longterm: Mission[] }
export interface Alert { icon: string; title: string; body?: string; href?: string }
export interface ActivityItem { icon: string; label: string; at: string }
export interface QuickAction { key: string; label: string; href: string; primary?: boolean }
export interface MoneyItem { label: string; amount_cents: number }
export interface HealthFactor { label: string; score: number; max: number }
export interface Goal { key: string; label: string; current: number; target: number; unit: 'money' | 'count' }
export interface ChannelPerf { channel: string; label: string; customers: number }

export interface DashboardExtras {
  focus: FocusItem[]
  quickActions: QuickAction[]
  moneyOnTable: { monthly_cents: number; items: MoneyItem[] }
  health: { score: number; factors: HealthFactor[] }
  forecast: { monthly_cents: number; annual_cents: number; customers: number; level: string }
  goals: Goal[]
  topChannel: ChannelPerf | null
  missions: GroupedMissions
  alerts: Alert[]
  activity: ActivityItem[]
  ecosystem: ActivityItem[]
}

interface Signals { linkCount: number; demoCount: number; sharedCount: number; clicks: number; certified: boolean }

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()
const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString() }
const EST_PER_CUSTOMER_MONTHLY = 8910 // ≈30% of a $297 plan — the estimated monthly commission per customer

const CHANNEL_LABEL: Record<string, string> = { meta: 'Meta', google: 'Google', tiktok: 'TikTok', linkedin: 'LinkedIn', email: 'Email', organic: 'Organic', referral: 'Direct Referral', other: 'Other' }

const AUDIT_LABELS: Record<string, string> = {
  'link.created': 'You created a referral link', 'demo.created': 'You generated a demo', 'demo.sent': 'You sent a demo to a prospect',
  'referral.signup': 'A prospect signed up through you', 'referral.paid': 'A customer started paying — commission earned', 'referral.churned': 'A customer cancelled',
  'member.invited': 'You invited a teammate', 'partner.created': 'You joined the partner network', 'api_key.created': 'You created an API key',
}
const AUDIT_ICON: Record<string, string> = {
  'link.created': 'link', 'demo.created': 'demo', 'demo.sent': 'send', 'referral.signup': 'customer',
  'referral.paid': 'earnings', 'referral.churned': 'trend', 'member.invited': 'team', 'partner.created': 'flame', 'api_key.created': 'zap',
}

export async function getDashboardExtras(partnerId: string, enabledModules: PartnerModuleKey[], stats: PartnerStatsFull, signals: Signals): Promise<DashboardExtras> {
  const db = createAdminClient()
  const has = (m: PartnerModuleKey) => enabledModules.includes(m)

  const [refsRes, demosRes, xpRes, campRes, leadsRes, auditRes, ecoRes] = await Promise.all([
    db.from('referrals').select('id, status, campaign_id, created_at, converted_at').eq('partner_id', partnerId).neq('status', 'rejected'),
    db.from('demos').select('created_at').eq('partner_id', partnerId),
    db.from('partner_xp_events').select('kind, xp, created_at').eq('partner_id', partnerId),
    db.from('campaigns').select('id, channel, status').eq('partner_id', partnerId),
    db.from('crm_leads').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId).in('stage', ['lead', 'qualified']),
    db.from('partner_audit_log').select('action, created_at').eq('partner_id', partnerId).order('created_at', { ascending: false }).limit(8),
    db.from('partner_xp_events').select('label, created_at').like('kind', 'ach:%').not('label', 'is', null).order('created_at', { ascending: false }).limit(6),
  ])

  const refs = refsRes.data || []
  const demos = demosRes.data || []
  const xpEvents = xpRes.data || []
  const camps = campRes.data || []
  const leads = leadsRes.count || 0

  const todayIso = startOfToday(), weekAgo = daysAgo(7), monthIso = startOfMonth(), d30 = daysAgo(30), d90 = daysAgo(90)
  const demosToday = demos.filter((d) => d.created_at >= todayIso).length
  const demosWeek = demos.filter((d) => d.created_at >= weekAgo).length
  const demos30 = demos.filter((d) => d.created_at >= d30).length
  const sharesToday = xpEvents.filter((e) => e.kind === 'demo_shared' && e.created_at >= todayIso).length
  const signupsWeek = refs.filter((r) => r.created_at >= weekAgo).length
  const customersMonth = refs.filter((r) => r.status === 'paid' && (r.converted_at || '') >= monthIso).length
  const paid90 = refs.filter((r) => r.status === 'paid' && (r.converted_at || '') >= d90).length
  const trials = refs.filter((r) => r.status === 'signup' || r.status === 'trial').length
  const xp30 = xpEvents.filter((e) => e.created_at >= d30).reduce((s, e) => s + (e.xp || 0), 0)
  const activeCampaigns = camps.filter((c) => c.status === 'active').length
  const perCustomer = stats.active_customers > 0 && stats.monthly_commission_cents > 0 ? Math.round(stats.monthly_commission_cents / stats.active_customers) : EST_PER_CUSTOMER_MONTHLY
  const lvl = levelForXp(stats.xp)

  // ── Money left on the table (unrealized monthly recurring income) ──
  const moneyItems: MoneyItem[] = []
  if (trials > 0) moneyItems.push({ label: `${trials} trial${trials === 1 ? '' : 's'} not yet converted`, amount_cents: trials * perCustomer })
  if (leads > 0) moneyItems.push({ label: `${leads} prospect${leads === 1 ? '' : 's'} in your pipeline`, amount_cents: leads * perCustomer })
  const moneyOnTable = { monthly_cents: moneyItems.reduce((s, i) => s + i.amount_cents, 0), items: moneyItems }

  // ── Health score (0–100) across the whole business ──
  const factors: HealthFactor[] = [
    { label: 'Referrals', score: (signals.linkCount > 0 ? 10 : 0) + (signals.clicks > 0 ? 10 : 0), max: 20 },
    { label: 'Demos', score: (demos30 >= 1 ? 10 : 0) + (demos30 >= 4 ? 10 : 0), max: 20 },
    { label: 'Outreach', score: signals.sharedCount > 0 ? 15 : 0, max: 15 },
    { label: 'Campaigns', score: activeCampaigns > 0 ? 15 : 0, max: 15 },
    { label: 'Academy', score: signals.certified ? 15 : 0, max: 15 },
    { label: 'Customers', score: (stats.active_customers > 0 ? 7 : 0) + (stats.conversion_rate >= 25 ? 8 : 0), max: 15 },
  ]
  const health = { score: factors.reduce((s, f) => s + f.score, 0), factors }

  // ── Forecast (simple trajectory; honest placeholders where thin) ──
  const monthlyRate = paid90 / 3
  const projectedCustomers = stats.active_customers + Math.round(monthlyRate * 12)
  const projectedMonthly = projectedCustomers * perCustomer
  const forecast = {
    customers: projectedCustomers,
    monthly_cents: projectedMonthly,
    annual_cents: projectedMonthly * 12,
    level: levelForXp(stats.xp + xp30 * 12).level,
  }

  // ── Goals (revenue / customers / demos — editable later) ──
  const nextTierCustomers = stats.active_customers < 11 ? 11 : stats.active_customers < 31 ? 31 : stats.active_customers < 76 ? 76 : stats.active_customers < 201 ? 201 : stats.active_customers
  const goals: Goal[] = [
    { key: 'revenue', label: 'Monthly recurring income', current: stats.monthly_commission_cents, target: 100000, unit: 'money' },
    { key: 'customers', label: 'Active customers', current: stats.active_customers, target: nextTierCustomers, unit: 'count' },
    { key: 'demos', label: 'Demos this month', current: demos30, target: 20, unit: 'count' },
  ]

  // ── Top performing channel ──
  const chanByCampaign: Record<string, string> = Object.fromEntries(camps.map((c) => [c.id, c.channel || 'other']))
  const byChannel: Record<string, number> = {}
  for (const r of refs) {
    if (r.status !== 'paid') continue
    const ch = r.campaign_id ? (chanByCampaign[r.campaign_id] || 'other') : 'referral'
    byChannel[ch] = (byChannel[ch] || 0) + 1
  }
  const bestChannel = Object.entries(byChannel).sort((a, b) => b[1] - a[1])[0]
  const topChannel: ChannelPerf | null = bestChannel ? { channel: bestChannel[0], label: CHANNEL_LABEL[bestChannel[0]] || bestChannel[0], customers: bestChannel[1] }
    : stats.total_customers > 0 ? { channel: 'referral', label: 'Direct Referral', customers: stats.active_customers } : null

  // ── Today's Focus (top 3, prioritized) ──
  const focus: FocusItem[] = []
  if (has('referrals') && signals.linkCount === 0) focus.push({ icon: 'link', title: 'Create your referral link', cta: 'Create link', href: '/partner/referrals', tone: 'action' })
  if (has('demos') && signals.demoCount === 0) focus.push({ icon: 'demo', title: 'Generate your first AI demo', cta: 'Generate demo', href: '/partner/demos', tone: 'action' })
  else if (has('demos') && demosToday < 2) focus.push({ icon: 'demo', title: `Generate ${2 - demosToday} more demo${2 - demosToday === 1 ? '' : 's'} today`, cta: 'Generate demo', href: '/partner/demos', tone: 'action' })
  if (has('demos') && signals.demoCount > 0 && signals.sharedCount === 0) focus.push({ icon: 'send', title: 'Send a demo to a prospect', cta: 'Send demo', href: '/partner/demos', tone: 'action' })
  if (has('crm') && leads > 0) focus.push({ icon: 'customer', title: `Follow up with ${leads} prospect${leads === 1 ? '' : 's'}`, cta: 'Open pipeline', href: '/partner/pipeline', tone: 'action' })
  if (has('marketing') && activeCampaigns === 0 && signals.demoCount > 0) focus.push({ icon: 'campaign', title: 'Launch your first campaign', cta: 'Launch', href: '/partner/marketing', tone: 'tip' })
  if (has('academy') && !signals.certified) focus.push({ icon: 'cert', title: 'Earn your certification', cta: 'Open Academy', href: '/partner/learning', tone: 'tip' })
  const focusTop = focus.slice(0, 3)

  // ── Missions grouped ──
  const missions: GroupedMissions = {
    daily: [
      { label: 'Generate a demo', current: Math.min(demosToday, 1), target: 1, xp: XP.demo_created, href: '/partner/demos' },
      { label: 'Send a demo to a prospect', current: Math.min(sharesToday, 1), target: 1, xp: XP.demo_shared, href: '/partner/demos' },
    ],
    weekly: [
      { label: 'Generate 5 demos this week', current: demosWeek, target: 5, xp: 0, href: '/partner/demos' },
      { label: 'Bring in 3 signups this week', current: signupsWeek, target: 3, xp: 0, href: '/partner/referrals' },
    ],
    monthly: [{ label: 'Sign 10 customers this month', current: customersMonth, target: 10, xp: 0, href: '/partner/customers' }],
    longterm: [
      { label: 'Grow to 10 customers — unlock Gold', current: stats.active_customers, target: 10, xp: 250, href: '/partner/customers' },
      { label: 'Earn your certification', current: signals.certified ? 1 : 0, target: 1, xp: XP.certification, href: '/partner/learning' },
    ],
  }
  if (lvl.nextLevel) missions.longterm.push({ label: `Reach ${lvl.nextLevel}`, current: stats.xp - lvl.prevAt, target: (lvl.nextAt || stats.xp) - lvl.prevAt, xp: 0, href: '/partner' })

  // ── Alerts (data-fed) ──
  const alerts: Alert[] = []
  if (leads > 0) alerts.push({ icon: 'customer', title: `${leads} prospect${leads === 1 ? ' is' : 's are'} waiting for follow-up`, body: 'Following up within 24h converts best.', href: '/partner/pipeline' })
  const toGold = 10 - stats.active_customers
  if (stats.active_customers > 0 && toGold > 0 && toGold <= 3) alerts.push({ icon: 'earnings', title: `You're ${toGold} customer${toGold === 1 ? '' : 's'} from a higher commission rate`, body: 'Each new customer also lifts your rate on the whole book.', href: '/partner/customers' })
  if (topChannel && byChannel[topChannel.channel]) alerts.push({ icon: 'campaign', title: `${topChannel.label} is your strongest channel`, body: `${topChannel.customers} of your customers came through it — lean in.`, href: '/partner/marketing' })

  // ── Activity + ecosystem ──
  const activity: ActivityItem[] = (auditRes.data || []).map((a) => ({ icon: AUDIT_ICON[a.action] || 'zap', label: AUDIT_LABELS[a.action] || a.action.replace(/[._]/g, ' '), at: a.created_at }))
  const ecosystem: ActivityItem[] = (ecoRes.data || []).map((e) => ({ icon: 'flame', label: `A partner unlocked ${e.label}`, at: e.created_at }))

  // ── Quick actions (state-aware ordering + labels) ──
  const quick: QuickAction[] = []
  if (has('demos')) quick.push({ key: 'demo', label: signals.demoCount === 0 ? 'Generate your first demo' : 'Generate Demo', href: '/partner/demos', primary: signals.demoCount === 0 || demosToday < 2 })
  if (has('referrals')) quick.push({ key: 'link', label: signals.linkCount === 0 ? 'Create your first link' : 'Create Referral Link', href: '/partner/referrals', primary: signals.linkCount === 0 })
  if (has('crm') && leads > 0) quick.push({ key: 'followup', label: `Follow up (${leads})`, href: '/partner/pipeline', primary: true })
  if (has('marketing')) quick.push({ key: 'campaign', label: activeCampaigns === 0 ? 'Launch a Campaign' : 'Marketing OS', href: '/partner/marketing' })
  if (has('coach')) quick.push({ key: 'write', label: 'Write Outreach', href: '/partner/coach' })
  if (has('team')) quick.push({ key: 'team', label: 'Invite Team', href: '/partner/team' })
  const quickActions = quick.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0)).slice(0, 5)

  return { focus: focusTop, quickActions, moneyOnTable, health, forecast, goals, topChannel, missions, alerts, activity, ecosystem }
}

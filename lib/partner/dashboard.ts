import { createAdminClient } from '@/lib/supabase/server'
import { XP, levelForXp } from '@/lib/partner/xp'
import type { PartnerStatsFull } from '@/lib/partner/stats'
import type { PartnerModuleKey } from '@/lib/partner/modules'

// Assembles the "operating system" model for the partner dashboard: Today's Focus, grouped missions
// with progress, AI alerts, a live activity feed, and quick actions. Deterministic now (the AI
// prioritizes these later); all derived from existing tables. Read-only.

export interface FocusItem { icon: string; title: string; cta: string; href: string; tone: 'action' | 'tip' }
export interface Mission { label: string; current: number; target: number; xp: number; href: string }
export interface GroupedMissions { daily: Mission[]; weekly: Mission[]; monthly: Mission[]; longterm: Mission[] }
export interface Alert { icon: string; title: string; body?: string; href?: string }
export interface ActivityItem { icon: string; label: string; at: string }
export interface QuickAction { key: string; label: string; href: string; module?: PartnerModuleKey }

export interface DashboardExtras {
  focus: FocusItem[]
  missions: GroupedMissions
  alerts: Alert[]
  activity: ActivityItem[]
  quickActions: QuickAction[]
}

interface Signals { linkCount: number; demoCount: number; sharedCount: number; clicks: number; certified: boolean }

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()
const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString() }

const AUDIT_LABELS: Record<string, string> = {
  'link.created': 'Referral link created', 'demo.created': 'Demo generated', 'demo.sent': 'Demo sent to a prospect',
  'referral.signup': 'New referred signup', 'referral.paid': 'Customer converted to paid', 'referral.churned': 'A customer churned',
  'member.invited': 'Team member invited', 'partner.created': 'Joined the partner program', 'api_key.created': 'API key created',
}
const AUDIT_ICON: Record<string, string> = {
  'link.created': 'link', 'demo.created': 'demo', 'demo.sent': 'send', 'referral.signup': 'customer',
  'referral.paid': 'earnings', 'referral.churned': 'trend', 'member.invited': 'team', 'partner.created': 'flame', 'api_key.created': 'zap',
}

export async function getDashboardExtras(partnerId: string, enabledModules: PartnerModuleKey[], stats: PartnerStatsFull, signals: Signals): Promise<DashboardExtras> {
  const db = createAdminClient()
  const has = (m: PartnerModuleKey) => enabledModules.includes(m)

  const [demosToday, demosWeek, sharesToday, signupsWeek, customersMonth, leadsAwaiting, audit] = await Promise.all([
    db.from('demos').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId).gte('created_at', startOfToday()),
    db.from('demos').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId).gte('created_at', daysAgo(7)),
    db.from('partner_xp_events').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId).eq('kind', 'demo_shared').gte('created_at', startOfToday()),
    db.from('referrals').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId).neq('status', 'rejected').gte('created_at', daysAgo(7)),
    db.from('referrals').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId).eq('status', 'paid').gte('converted_at', startOfMonth()),
    db.from('crm_leads').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId).in('stage', ['lead', 'qualified']),
    db.from('partner_audit_log').select('action, created_at').eq('partner_id', partnerId).order('created_at', { ascending: false }).limit(8),
  ])
  const dToday = demosToday.count || 0, dWeek = demosWeek.count || 0, shToday = sharesToday.count || 0
  const suWeek = signupsWeek.count || 0, cMonth = customersMonth.count || 0, leads = leadsAwaiting.count || 0
  const lvl = levelForXp(stats.xp)

  // ── Today's Focus (top 3, prioritized; TTFC-critical path first) ──
  const focus: FocusItem[] = []
  if (has('referrals') && signals.linkCount === 0) focus.push({ icon: 'link', title: 'Create your referral link', cta: 'Create link', href: '/partner/referrals', tone: 'action' })
  if (has('demos') && signals.demoCount === 0) focus.push({ icon: 'demo', title: 'Generate your first AI demo', cta: 'Generate demo', href: '/partner/demos', tone: 'action' })
  else if (has('demos') && dToday < 2) focus.push({ icon: 'demo', title: `Generate ${2 - dToday} more demo${2 - dToday === 1 ? '' : 's'} today`, cta: 'Generate demo', href: '/partner/demos', tone: 'action' })
  if (has('demos') && signals.demoCount > 0 && signals.sharedCount === 0) focus.push({ icon: 'send', title: 'Send a demo to a prospect', cta: 'Send demo', href: '/partner/demos', tone: 'action' })
  if (has('crm') && leads > 0) focus.push({ icon: 'customer', title: `Follow up with ${leads} prospect${leads === 1 ? '' : 's'}`, cta: 'Open pipeline', href: '/partner/pipeline', tone: 'action' })
  if (has('academy') && !signals.certified) focus.push({ icon: 'cert', title: 'Complete your next Academy lesson', cta: 'Open Academy', href: '/partner/learning', tone: 'tip' })
  if (lvl.nextLevel && lvl.xpToNext != null && lvl.xpToNext <= 300) focus.push({ icon: 'flame', title: `You're ${lvl.xpToNext} XP from ${lvl.nextLevel}`, cta: 'See how', href: '/partner/demos', tone: 'tip' })
  const focusTop = focus.slice(0, 3)

  // ── Missions grouped, with progress ──
  const missions: GroupedMissions = {
    daily: [
      { label: 'Generate a demo', current: Math.min(dToday, 1), target: 1, xp: XP.demo_created, href: '/partner/demos' },
      { label: 'Send a demo to a prospect', current: Math.min(shToday, 1), target: 1, xp: XP.demo_shared, href: '/partner/demos' },
    ],
    weekly: [
      { label: 'Generate 5 demos this week', current: dWeek, target: 5, xp: 0, href: '/partner/demos' },
      { label: 'Get 3 signups this week', current: suWeek, target: 3, xp: 0, href: '/partner/referrals' },
    ],
    monthly: [
      { label: 'Reach 10 customers this month', current: cMonth, target: 10, xp: 0, href: '/partner/customers' },
    ],
    longterm: [
      { label: 'Close 10 customers — unlock Gold', current: stats.active_customers, target: 10, xp: 250, href: '/partner/customers' },
      { label: 'Earn your certification', current: signals.certified ? 1 : 0, target: 1, xp: XP.certification, href: '/partner/learning' },
    ],
  }
  if (lvl.nextLevel) missions.longterm.push({ label: `Reach ${lvl.nextLevel}`, current: stats.xp - lvl.prevAt, target: (lvl.nextAt || stats.xp) - lvl.prevAt, xp: 0, href: '/partner' })

  // ── AI alerts (the future AI Business Manager area — deterministic for now) ──
  const alerts: Alert[] = []
  if (leads > 0) alerts.push({ icon: 'customer', title: `${leads} prospect${leads === 1 ? ' is' : 's are'} waiting for follow-up`, body: 'Following up within 24h converts best.', href: '/partner/pipeline' })
  const toGold = 10 - stats.active_customers
  if (stats.active_customers > 0 && toGold > 0 && toGold <= 3) alerts.push({ icon: 'earnings', title: `You're ${toGold} customer${toGold === 1 ? '' : 's'} from a higher commission tier`, body: 'Each new customer also lifts your rate.', href: '/partner/customers' })
  if (stats.total_customers >= 4 && stats.conversion_rate < 25) alerts.push({ icon: 'trend', title: 'Your conversion rate has room to grow', body: `You're at ${stats.conversion_rate}%. Personalized demos lift it most.`, href: '/partner/demos' })

  // ── Recent activity ──
  const activity: ActivityItem[] = (audit.data || []).map((a) => ({
    icon: AUDIT_ICON[a.action] || 'zap', label: AUDIT_LABELS[a.action] || a.action.replace(/[._]/g, ' '), at: a.created_at,
  }))

  // ── Quick actions (gated by enabled modules) ──
  const allQuick: QuickAction[] = [
    { key: 'demo', label: 'Generate Demo', href: '/partner/demos', module: 'demos' },
    { key: 'link', label: 'Create Referral Link', href: '/partner/referrals', module: 'referrals' },
    { key: 'campaign', label: 'Launch Campaign', href: '/partner/marketing', module: 'marketing' },
    { key: 'write', label: 'Write Outreach', href: '/partner/coach', module: 'coach' },
    { key: 'team', label: 'Invite Team', href: '/partner/team', module: 'team' },
  ]
  const quickActions = allQuick.filter((q) => !q.module || has(q.module))

  return { focus: focusTop, missions, alerts, activity, quickActions }
}

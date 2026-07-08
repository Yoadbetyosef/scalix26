import { createAdminClient } from '@/lib/supabase/server'
import { levelForXp, XP } from '@/lib/partner/xp'
import type { PartnerStatsFull } from '@/lib/partner/stats'

// The AI Sales Coach: deterministic next-best-action engine. Every card answers "what should this
// partner do NEXT to make more money?" — no passive metrics. Cheap (no LLM); the outreach-email
// generator (LLM) lives in /api/partner/coach/email.

export interface Mission { key: string; label: string; xp: number; done: boolean; href: string }
export interface CoachCard { icon: string; title: string; body?: string; cta?: string; href?: string; tone: 'action' | 'win' | 'tip' }

export interface CoachData {
  missions: Mission[]
  cards: CoachCard[]
  signals: { linkCount: number; demoCount: number; sharedCount: number; clicks: number; certified: boolean }
}

export async function getCoach(partnerId: string, stats: PartnerStatsFull): Promise<CoachData> {
  const db = createAdminClient()
  const [{ count: linkCount }, { count: demoCount }, { data: links }, { data: shares }, { count: certCount }] = await Promise.all([
    db.from('referral_links').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId),
    db.from('demos').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId),
    db.from('referral_links').select('click_count').eq('partner_id', partnerId),
    db.from('partner_xp_events').select('id').eq('partner_id', partnerId).eq('kind', 'demo_shared').limit(1),
    db.from('certifications').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId),
  ])
  const clicks = (links || []).reduce((s, l) => s + (l.click_count || 0), 0)
  const sharedCount = (shares || []).length
  const certified = (certCount || 0) > 0
  const lc = linkCount || 0, dc = demoCount || 0

  const missions: Mission[] = [
    { key: 'link', label: 'Create your referral link', xp: XP.first_link, done: lc > 0, href: '/partner/referrals' },
    { key: 'demo', label: 'Generate your first AI demo', xp: XP.first_demo_bonus + XP.demo_created, done: dc > 0, href: '/partner/demos' },
    { key: 'share', label: 'Send a demo to a prospect', xp: XP.demo_shared, done: sharedCount > 0, href: '/partner/demos' },
    { key: 'customer', label: 'Close your first customer', xp: 200, done: stats.active_customers >= 1, href: '/partner/customers' },
    { key: 'ten', label: 'Close 10 customers — unlock Gold', xp: 250, done: stats.active_customers >= 10, href: '/partner/customers' },
  ]

  const cards: CoachCard[] = []
  const lvl = levelForXp(stats.xp)

  // Momentum toward the next level.
  if (lvl.nextLevel && lvl.xpToNext != null && lvl.xpToNext <= 400) {
    cards.push({ icon: '🔥', title: `You're ${lvl.xpToNext} XP from ${lvl.nextLevel}`, body: 'Generate a demo or close a deal to level up.', cta: 'Generate a demo', href: '/partner/demos', tone: 'action' })
  }
  // The critical TTFC path.
  if (lc === 0) cards.push({ icon: '🔗', title: 'Create your referral link', body: 'It takes 5 seconds and unlocks everything else.', cta: 'Create link', href: '/partner/referrals', tone: 'action' })
  else if (dc === 0) cards.push({ icon: '🎬', title: 'Generate your first AI demo', body: 'A personalized demo is your #1 closing tool.', cta: 'Generate demo', href: '/partner/demos', tone: 'action' })
  else if (sharedCount === 0) cards.push({ icon: '📤', title: 'Send a demo to a prospect', body: 'Demos close deals by themselves — get one in front of a business today.', cta: 'Send a demo', href: '/partner/demos', tone: 'action' })

  if (clicks > 0 && dc === 0) cards.push({ icon: '👀', title: `Your link has ${clicks} clicks but no demos yet`, body: 'Turn that interest into demos to start converting.', cta: 'Generate a demo', href: '/partner/demos', tone: 'tip' })

  if (stats.total_customers >= 4 && stats.conversion_rate < 25) cards.push({ icon: '📉', title: 'Your conversion rate has room to grow', body: `You're at ${stats.conversion_rate}%. Following up within 24h of a demo lifts conversions the most.`, tone: 'tip' })

  if (dc > 0 && dc < 3) cards.push({ icon: '⚡', title: 'Generate 3 demos this week', body: 'Volume wins. Partners who send 3+ demos/week close 3× more.', cta: 'Generate a demo', href: '/partner/demos', tone: 'action' })

  if (!certified) cards.push({ icon: '🎓', title: 'Get certified to sell faster', body: 'The Academy exam earns your Certified Partner badge (+100 XP).', cta: 'Open Academy', href: '/partner/learning', tone: 'tip' })

  // A projected-earnings nudge if they have momentum.
  if (stats.active_customers >= 1) {
    const projAnnual = stats.mrr_generated_cents * 12
    cards.push({ icon: '💰', title: `You're on track for ${(projAnnual / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}/yr`, body: 'Each new customer adds recurring income for life. Keep going.', cta: 'Refer more', href: '/partner/referrals', tone: 'win' })
  }

  // Always offer the AI-written outreach.
  cards.push({ icon: '✍️', title: 'Get a personalized outreach message', body: 'Let your AI coach write a cold email tailored to a niche.', cta: 'Write outreach', href: '/partner/coach', tone: 'tip' })

  return { missions, cards: cards.slice(0, 5), signals: { linkCount: lc, demoCount: dc, sharedCount, clicks, certified } }
}

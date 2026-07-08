import { createAdminClient } from '@/lib/supabase/server'

// ── The XP economy (defaults — tune freely; changing thresholds is safe) ─────────────────────
// Action XP is granted at action time. Milestone/achievement XP is granted idempotently.
export const XP = {
  first_link: 5,          // create your first referral link (mission)
  demo_created: 10,       // each demo generated
  first_demo_bonus: 10,   // +10 on the first demo (total 20, matches spec)
  demo_shared: 50,        // each time you send a demo to a prospect
  referral_signup: 15,    // someone signs up through your link
  customer_paid: 200,     // a referred customer converts to paid
  lesson_complete: 10,    // finish an Academy lesson
  certification: 100,     // earn a certification
} as const

// Levels by cumulative XP. Names come from the spec.
export const LEVELS: { key: string; label: string; minXp: number }[] = [
  { key: 'starter', label: 'Starter', minXp: 0 },
  { key: 'silver', label: 'Silver', minXp: 300 },
  { key: 'gold', label: 'Gold', minXp: 2000 },
  { key: 'platinum', label: 'Platinum', minXp: 6000 },
  { key: 'diamond', label: 'Diamond', minXp: 18000 },
  { key: 'elite', label: 'Elite', minXp: 45000 },
]

export interface LevelInfo {
  level: string; levelKey: string; xp: number
  nextLevel: string | null; nextAt: number | null; prevAt: number; progressPct: number; xpToNext: number | null
}

export function levelForXp(xp: number): LevelInfo {
  let idx = 0
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].minXp) idx = i
  const cur = LEVELS[idx]
  const next = LEVELS[idx + 1] || null
  const prevAt = cur.minXp
  const nextAt = next?.minXp ?? null
  const progressPct = next ? Math.min(100, Math.round(((xp - prevAt) / (next.minXp - prevAt)) * 100)) : 100
  return { level: cur.label, levelKey: cur.key, xp, nextLevel: next?.label ?? null, nextAt, prevAt, progressPct, xpToNext: nextAt != null ? Math.max(0, nextAt - xp) : null }
}

// Achievements (milestone badges). Evaluated from aggregates in refreshPartnerStats().
export interface Achievement { key: string; label: string; xp: number; icon: string }
// `icon` is a Scalix icon key (rendered via lucide), never an emoji.
export const ACHIEVEMENTS: Record<string, Achievement> = {
  first_referral: { key: 'first_referral', label: 'First Referral', xp: 25, icon: 'link' },
  first_demo: { key: 'first_demo', label: 'First Demo', xp: 25, icon: 'demo' },
  first_customer: { key: 'first_customer', label: 'Certified Partner', xp: 100, icon: 'award' },
  ten_customers: { key: 'ten_customers', label: 'Gold Partner', xp: 250, icon: 'medal' },
  hundred_customers: { key: 'hundred_customers', label: 'Centurion', xp: 1000, icon: 'trophy' },
  commission_1k: { key: 'commission_1k', label: '$1,000 Earned', xp: 150, icon: 'dollar' },
  commission_10k: { key: 'commission_10k', label: '$10,000 Earned', xp: 750, icon: 'gem' },
  one_year: { key: 'one_year', label: '1 Year Partner', xp: 200, icon: 'cake' },
}

type Db = ReturnType<typeof createAdminClient>

/**
 * Grant XP. For one-time awards pass a uniqueKey (idempotent). Returns true if newly granted.
 * On a new grant that crosses a level threshold, drops a celebratory notification.
 */
export async function awardXp(partnerId: string, kind: string, xp: number, opts?: { uniqueKey?: string; label?: string; userId?: string; meta?: Record<string, unknown> }): Promise<boolean> {
  try {
    const db = createAdminClient()
    // One-time awards: skip if the unique_key already exists (partial unique index also guards
    // the race at the DB level, where a duplicate insert throws and we treat it as not-granted).
    if (opts?.uniqueKey) {
      const { data: existing } = await db.from('partner_xp_events').select('id').eq('unique_key', opts.uniqueKey).limit(1).maybeSingle()
      if (existing) return false
    }
    const beforeXp = await totalXp(db, partnerId)
    const { error } = await db.from('partner_xp_events')
      .insert({ partner_id: partnerId, user_id: opts?.userId || null, kind, xp, label: opts?.label || null, unique_key: opts?.uniqueKey || null, meta: opts?.meta || {} })
    if (error) return false  // unique violation on a raced one-time award — already granted
    const granted = true

    // Achievement celebration.
    if (opts?.label) {
      await db.from('partner_notifications').insert({ partner_id: partnerId, kind: 'achievement', title: `Achievement unlocked: ${opts.label}`, body: `+${xp} XP`, link: '/partner' })
    }
    // Level-up celebration.
    const afterXp = beforeXp + (granted ? xp : 0)
    const before = levelForXp(beforeXp).levelKey
    const after = levelForXp(afterXp).levelKey
    if (before !== after) {
      await db.from('partner_notifications').insert({ partner_id: partnerId, kind: 'level_up', title: `Level up! You reached ${levelForXp(afterXp).level}`, body: 'Keep the momentum going.', link: '/partner' })
    }
    return true
  } catch (e) {
    console.error('[xp] award failed:', (e as Error).message)
    return false
  }
}

export async function totalXp(db: Db, partnerId: string): Promise<number> {
  const { data } = await db.from('partner_xp_events').select('xp').eq('partner_id', partnerId)
  return (data || []).reduce((s, e) => s + (e.xp || 0), 0)
}

/** Earned achievement keys for a partner. */
export async function earnedAchievements(partnerId: string): Promise<Set<string>> {
  const db = createAdminClient()
  const { data } = await db.from('partner_xp_events').select('kind').eq('partner_id', partnerId).like('kind', 'ach:%')
  return new Set((data || []).map((e) => e.kind.replace('ach:', '')))
}

/** Consecutive-day activity streak from XP-event dates (UTC day granularity). */
export async function computeStreak(db: Db, partnerId: string): Promise<number> {
  const { data } = await db.from('partner_xp_events').select('created_at').eq('partner_id', partnerId).order('created_at', { ascending: false }).limit(200)
  const days = new Set((data || []).map((e) => e.created_at.slice(0, 10)))
  let streak = 0
  const d = new Date()
  // Allow "today or yesterday" to start the streak (so it doesn't reset before daily activity).
  const todayKey = d.toISOString().slice(0, 10)
  const yest = new Date(d.getTime() - 86400000).toISOString().slice(0, 10)
  if (!days.has(todayKey) && !days.has(yest)) return 0
  const cursor = new Date(days.has(todayKey) ? d : new Date(d.getTime() - 86400000))
  for (;;) {
    const key = cursor.toISOString().slice(0, 10)
    if (days.has(key)) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1) } else break
  }
  return streak
}

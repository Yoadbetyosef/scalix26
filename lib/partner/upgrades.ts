import { createAdminClient } from '@/lib/supabase/server'

// Fully-configurable upgrade engine. Reads admin-editable upgrade_rules and nudges partners toward
// the next type/tier when they cross a threshold. Nothing hardcoded — thresholds, metrics, types,
// messages, and actions all live in the DB. Idempotent per (partner, rule) via a notification marker.

type Metric = 'active_customers' | 'mrr_cents' | 'xp' | 'lifetime_earnings_cents'

const metricValue = (stats: Record<string, number | null>, m: string): number => {
  switch (m as Metric) {
    case 'active_customers': return stats.active_customers || 0
    case 'mrr_cents': return stats.mrr_generated_cents || 0
    case 'xp': return stats.xp || 0
    case 'lifetime_earnings_cents': return stats.lifetime_earnings_cents || 0
    default: return 0
  }
}

export async function evaluateUpgrades(): Promise<number> {
  const db = createAdminClient()
  const [{ data: rules }, { data: statsRows }] = await Promise.all([
    db.from('upgrade_rules').select('*').eq('active', true).order('sort', { ascending: true }),
    db.from('partner_stats').select('partner_id, active_customers, mrr_generated_cents, xp, lifetime_earnings_cents, partners(partner_type, tier)'),
  ])
  if (!rules?.length || !statsRows?.length) return 0

  let fired = 0
  for (const row of statsRows) {
    const partner = row.partners as unknown as { partner_type: string; tier: number } | null
    if (!partner) continue
    const partnerId = row.partner_id as string
    for (const rule of rules) {
      if (rule.from_type && rule.from_type !== partner.partner_type) continue
      if (metricValue(row as unknown as Record<string, number | null>, rule.metric) < Number(rule.threshold)) continue

      if (rule.action === 'set_tier' && rule.to_tier != null) {
        if ((partner.tier || 0) < rule.to_tier) { await db.from('partners').update({ tier: rule.to_tier }).eq('id', partnerId); fired++ }
        continue
      }
      // notify / suggest_type — dedupe by a stable marker so we never nudge twice for the same rule.
      const marker = `/partner?upgrade=${rule.id}`
      const { data: existing } = await db.from('partner_notifications').select('id').eq('partner_id', partnerId).eq('link', marker).limit(1).maybeSingle()
      if (existing) continue
      await db.from('partner_notifications').insert({
        partner_id: partnerId, kind: 'upgrade',
        title: rule.action === 'suggest_type' ? `You've unlocked ${rule.to_type || 'the next level'}` : rule.name,
        body: rule.message || 'You qualify for an upgrade.', link: marker,
      })
      fired++
    }
  }
  return fired
}

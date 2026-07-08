import { createAdminClient } from '@/lib/supabase/server'

// Marketing OS performance: rolls the attribution chain up to per-campaign and per-creative
// CAC / LTV / ROI / payback. Per-partner bounded (no global scans); cached to campaign_stats /
// creative_stats for O(1) reads. Clicks come from referral_links.click_count (not a click scan).

export interface CampaignPerf {
  campaign_id: string; name: string; channel: string | null; status: string
  clicks: number; signups: number; trials: number; paid: number
  commission_cents: number; spend_cents: number
  cac_cents: number | null; ltv_cents: number | null; roi_pct: number | null; payback_months: number | null
}
export interface CreativePerf {
  creative_id: string; title: string; type: string; status: string
  clicks: number; signups: number; paid: number; commission_cents: number
}

async function loadBase(partnerId: string) {
  const db = createAdminClient()
  const [{ data: campaigns }, { data: creatives }, { data: links }, { data: refs }, { data: entries }, { data: spend }] = await Promise.all([
    db.from('campaigns').select('id, name, channel, status').eq('partner_id', partnerId),
    db.from('creatives').select('id, title, type, status').eq('partner_id', partnerId),
    db.from('referral_links').select('campaign_id, creative_id, click_count').eq('partner_id', partnerId),
    db.from('referrals').select('id, campaign_id, creative_id, status').eq('partner_id', partnerId).neq('status', 'rejected'),
    db.from('commission_entries').select('referral_id, amount_cents, status').eq('partner_id', partnerId),
    db.from('partner_spend').select('campaign_id, amount_cents').eq('partner_id', partnerId),
  ])
  return { campaigns: campaigns || [], creatives: creatives || [], links: links || [], refs: refs || [], entries: entries || [], spend: spend || [] }
}

// commission (approved+paid) per referral id.
function commissionByReferral(entries: { referral_id: string | null; amount_cents: number; status: string }[]) {
  const m: Record<string, number> = {}
  for (const e of entries) { if (!e.referral_id) continue; if (e.status === 'void') continue; m[e.referral_id] = (m[e.referral_id] || 0) + e.amount_cents }
  return m
}

export async function computeCampaignPerformance(partnerId: string): Promise<CampaignPerf[]> {
  const { campaigns, links, refs, entries, spend } = await loadBase(partnerId)
  const commByRef = commissionByReferral(entries)
  return campaigns.map((c) => {
    const clicks = links.filter((l) => l.campaign_id === c.id).reduce((s, l) => s + (l.click_count || 0), 0)
    const crefs = refs.filter((r) => r.campaign_id === c.id)
    const paid = crefs.filter((r) => r.status === 'paid').length
    const trials = crefs.filter((r) => r.status === 'trial' || r.status === 'paid' || r.status === 'churned').length
    const commission = crefs.reduce((s, r) => s + (commByRef[r.id] || 0), 0)
    const spendC = spend.filter((s) => s.campaign_id === c.id).reduce((s, x) => s + x.amount_cents, 0)
    const cac = paid > 0 ? Math.round(spendC / paid) : null
    const ltv = paid > 0 ? Math.round(commission / paid) : null           // lifetime commission per customer
    const roi = spendC > 0 ? Math.round(((commission - spendC) / spendC) * 100) : null
    const monthly = commission / Math.max(1, /* rough active months */ 1)
    const payback = spendC > 0 && commission > 0 ? Math.round((spendC / (commission)) * 12 * 10) / 10 : null
    return {
      campaign_id: c.id, name: c.name, channel: c.channel, status: c.status,
      clicks, signups: crefs.length, trials, paid, commission_cents: commission, spend_cents: spendC,
      cac_cents: cac, ltv_cents: ltv, roi_pct: roi, payback_months: payback,
    }
  }).sort((a, b) => b.commission_cents - a.commission_cents)
}

export async function computeCreativePerformance(partnerId: string): Promise<CreativePerf[]> {
  const { creatives, links, refs, entries } = await loadBase(partnerId)
  const commByRef = commissionByReferral(entries)
  return creatives.map((c) => {
    const clicks = links.filter((l) => l.creative_id === c.id).reduce((s, l) => s + (l.click_count || 0), 0)
    const crefs = refs.filter((r) => r.creative_id === c.id)
    const paid = crefs.filter((r) => r.status === 'paid').length
    const commission = crefs.reduce((s, r) => s + (commByRef[r.id] || 0), 0)
    return { creative_id: c.id, title: c.title, type: c.type, status: c.status, clicks, signups: crefs.length, paid, commission_cents: commission }
  }).sort((a, b) => b.paid - a.paid || b.commission_cents - a.commission_cents)
}

/** Refresh marketing rollups for partners with recent activity (bounded work at scale). */
export async function recomputeMarketingStats(windowHours = 25): Promise<number> {
  const db = createAdminClient()
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()
  const { data: rows } = await db.from('campaigns').select('partner_id').gte('created_at', cutoff)
  const { data: refRows } = await db.from('referrals').select('partner_id').gte('created_at', cutoff)
  const ids = new Set<string>([...(rows || []).map((r) => r.partner_id), ...(refRows || []).map((r) => r.partner_id)])
  let n = 0
  for (const id of ids) { await refreshMarketingStats(id); n++ }
  return n
}

/** Persist rollups (cron). Keeps performance reads O(1) at scale. */
export async function refreshMarketingStats(partnerId: string): Promise<void> {
  const db = createAdminClient()
  const [camp, crea] = await Promise.all([computeCampaignPerformance(partnerId), computeCreativePerformance(partnerId)])
  for (const c of camp) {
    await db.from('campaign_stats').upsert({ campaign_id: c.campaign_id, partner_id: partnerId, clicks: c.clicks, signups: c.signups, trials: c.trials, paid: c.paid, commission_cents: c.commission_cents, spend_cents: c.spend_cents, computed_at: new Date().toISOString() }, { onConflict: 'campaign_id' })
  }
  for (const c of crea) {
    await db.from('creative_stats').upsert({ creative_id: c.creative_id, partner_id: partnerId, clicks: c.clicks, signups: c.signups, paid: c.paid, commission_cents: c.commission_cents, computed_at: new Date().toISOString() }, { onConflict: 'creative_id' })
  }
}

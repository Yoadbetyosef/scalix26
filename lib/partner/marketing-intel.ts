import { computeCampaignPerformance, computeCreativePerformance, computeFunnel } from '@/lib/partner/marketing-stats'

const money = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

// Marketing Intelligence — the always-on AI Marketing Coach. Deterministic (per the architecture:
// LLM only for language, never for money/counts). Reads the same rollups the dashboards use and
// emits prioritized, explained recommendations with one-tap deep links. Answers, for the partner:
// what happened, why, and what to do next.

export interface MarketingRec {
  id: string
  severity: 'bad' | 'warn' | 'good' | 'info'
  icon: string                                  // key → lucide (mapped client-side)
  title: string
  detail: string
  action?: { label: string; tab: string; campaignId?: string }
}

const RANK: Record<MarketingRec['severity'], number> = { bad: 0, warn: 1, good: 2, info: 3 }

export async function computeMarketingIntel(partnerId: string): Promise<MarketingRec[]> {
  const [camps, creatives, funnel] = await Promise.all([
    computeCampaignPerformance(partnerId),
    computeCreativePerformance(partnerId),
    computeFunnel(partnerId),
  ])
  const recs: MarketingRec[] = []
  const active = camps.filter((c) => c.status === 'active')

  // ── Best / worst campaigns ─────────────────────────────────────────
  const withPaid = camps.filter((c) => c.paid > 0 && c.roi_pct != null)
  const best = [...withPaid].sort((a, b) => (b.roi_pct! - a.roi_pct!))[0]
  if (best && best.roi_pct! > 0) {
    recs.push({ id: 'best-roi', severity: 'good', icon: 'trophy',
      title: `${best.name} is your highest-ROI campaign`,
      detail: `It's returning ${best.roi_pct}% (${best.paid} customer${best.paid === 1 ? '' : 's'} from ${money(best.spend_cents)} spend). Put more budget behind it and duplicate its winning creative.`,
      action: { label: 'Add budget', tab: 'spend', campaignId: best.campaign_id } })
  }
  for (const c of camps) {
    if (c.spend_cents > 0 && c.commission_cents < c.spend_cents && c.status !== 'archived') {
      recs.push({ id: `losing-${c.campaign_id}`, severity: 'bad', icon: 'trenddown',
        title: `${c.name} is losing money`,
        detail: `Spent ${money(c.spend_cents)}, earned ${money(c.commission_cents)} in commission so far. Pause it, or swap the creative and tighten the landing page before spending more.`,
        action: { label: 'Review campaign', tab: 'campaigns', campaignId: c.campaign_id } })
    }
  }

  // ── Funnel diagnostics ─────────────────────────────────────────────
  if (funnel.demo_starts > 0 && funnel.paid === 0) {
    recs.push({ id: 'demos-no-paid', severity: 'warn', icon: 'demo',
      title: 'Demos are happening — but no customers yet',
      detail: `${funnel.demo_starts} demo${funnel.demo_starts === 1 ? '' : 's'} started with 0 conversions. The gap is follow-up and close — load the Post-Demo Follow-up sequence and work every demo within 24h.`,
      action: { label: 'Open toolkit', tab: 'assets' } })
  }
  if (funnel.clicks >= 20 && funnel.demo_starts === 0) {
    recs.push({ id: 'clicks-no-demos', severity: 'warn', icon: 'click',
      title: 'You have traffic but no demos',
      detail: `${funnel.clicks} clicks and 0 demo starts — the page isn't converting the click. Strengthen the hero and CTA (try ✨ Improve hero on your landing page).`,
      action: { label: 'Landing pages', tab: 'landing' } })
  }
  if (funnel.lp_views >= 20 && funnel.clicks / Math.max(1, funnel.lp_views) < 0.15) {
    recs.push({ id: 'low-ctr', severity: 'warn', icon: 'target',
      title: 'Your landing-page CTR is low',
      detail: `Only ${Math.round((funnel.clicks / funnel.lp_views) * 100)}% of viewers click through. A sharper headline and a single, obvious CTA usually lift this fast — use ✨ Improve CTA.`,
      action: { label: 'Improve pages', tab: 'landing' } })
  }

  // ── Setup gaps on active campaigns ─────────────────────────────────
  for (const c of active) {
    if (c.creatives === 0) {
      recs.push({ id: `no-creative-${c.campaign_id}`, severity: 'warn', icon: 'palette',
        title: `${c.name} has no creative`,
        detail: 'A campaign with no message can\'t drive results. Add ad copy or a script — or generate one with AI in a click.',
        action: { label: 'Add creative', tab: 'creatives', campaignId: c.campaign_id } })
    } else if (c.links === 0 && c.landing_pages === 0) {
      recs.push({ id: `no-link-${c.campaign_id}`, severity: 'warn', icon: 'link',
        title: `${c.name} has nowhere to send traffic`,
        detail: 'No tracking link or landing page is attached, so clicks won\'t attribute. Create a landing page or copy a tracking link.',
        action: { label: 'Create page', tab: 'landing', campaignId: c.campaign_id } })
    }
  }

  // ── Best creative → duplicate & test ───────────────────────────────
  const topCreative = [...creatives].filter((c) => c.paid > 0).sort((a, b) => b.paid - a.paid)[0]
  if (topCreative) {
    recs.push({ id: 'best-creative', severity: 'good', icon: 'sparkles',
      title: `"${topCreative.title}" is your best performer`,
      detail: `It drove ${topCreative.paid} customer${topCreative.paid === 1 ? '' : 's'}. Duplicate it and generate 5 AI variations to A/B test more angles.`,
      action: { label: 'Open Creatives', tab: 'creatives' } })
  }

  // ── Coverage nudges ────────────────────────────────────────────────
  if (camps.length > 0 && funnel.spend_cents === 0) {
    recs.push({ id: 'log-spend', severity: 'info', icon: 'dollar',
      title: 'Log your ad spend to unlock true ROI',
      detail: 'You have campaigns but no spend recorded, so CAC and ROI can\'t be computed. Add what you\'ve spent per channel.',
      action: { label: 'Add spend', tab: 'spend' } })
  }
  const channels = new Set(camps.map((c) => c.channel).filter(Boolean))
  if (channels.size > 0 && !channels.has('google') && funnel.paid > 0) {
    recs.push({ id: 'try-google', severity: 'info', icon: 'search',
      title: 'Capture high-intent demand with Google',
      detail: 'You\'re converting on other channels but not running Google Search — that\'s where people actively look for a solution. Spin up a Google campaign with the Google Ads Starter kit.',
      action: { label: 'Build campaign', tab: 'campaigns' } })
  }
  if (creatives.length > 0 && creatives.length < 3) {
    recs.push({ id: 'more-creatives', severity: 'info', icon: 'test',
      title: 'Test more angles',
      detail: 'Winners come from volume. You have only a few creatives — generate variations and a new headline to test what resonates.',
      action: { label: 'Open Creatives', tab: 'creatives' } })
  }

  return recs.sort((a, b) => RANK[a.severity] - RANK[b.severity]).slice(0, 7)
}

import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { computeCampaignPerformance, computeCreativePerformance } from '@/lib/partner/marketing-stats'

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [campaigns, creatives] = await Promise.all([
    computeCampaignPerformance(ctx.partnerId),
    computeCreativePerformance(ctx.partnerId),
  ])
  const totals = campaigns.reduce((t, c) => ({
    spend_cents: t.spend_cents + c.spend_cents, commission_cents: t.commission_cents + c.commission_cents, paid: t.paid + c.paid,
  }), { spend_cents: 0, commission_cents: 0, paid: 0 })
  const overall = {
    ...totals,
    cac_cents: totals.paid > 0 ? Math.round(totals.spend_cents / totals.paid) : null,
    roi_pct: totals.spend_cents > 0 ? Math.round(((totals.commission_cents - totals.spend_cents) / totals.spend_cents) * 100) : null,
  }
  return NextResponse.json({ campaigns, creatives, overall })
}

import { NextResponse } from 'next/server'
import { getAdminContext } from '@/lib/admin/rbac'
import { getPartnerProfitability } from '@/lib/admin/platform-billing'

// GET /api/admin/wl-billing — internal White Label P&L per partner: active clients, MRR, wallet balance
// + reloads, provider cost, markup revenue, platform revenue, gross profit, net provider spend,
// outstanding, Stripe status. Admin-only (provider economics NEVER leave this surface).
export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const partners = await getPartnerProfitability()
  const totals = partners.reduce((t, p) => ({
    activeClients: t.activeClients + p.activeClients,
    mrrCents: t.mrrCents + p.mrrCents,
    platformRevenueCents: t.platformRevenueCents + p.platformRevenueCents,
    usageRevenueCents: t.usageRevenueCents + p.usageRevenueCents,
    providerCostCents: t.providerCostCents + p.providerCostCents,
    grossProfitCents: t.grossProfitCents + p.grossProfitCents,
    outstandingCents: t.outstandingCents + p.outstandingCents,
  }), { activeClients: 0, mrrCents: 0, platformRevenueCents: 0, usageRevenueCents: 0, providerCostCents: 0, grossProfitCents: 0, outstandingCents: 0 })

  return NextResponse.json({ partners, totals })
}

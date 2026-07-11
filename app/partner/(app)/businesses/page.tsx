import { redirect } from 'next/navigation'
import { getPartnerContext } from '@/lib/partner/rbac'
import { resolvePartnerEconomics } from '@/lib/partner/economics-resolve'
import { getBusinesses } from '@/lib/partner/company'
import { computeWholesaleSummary } from '@/lib/partner/wholesale'
import { getPartnerClients } from '@/lib/partner/economics-resolve'
import { BusinessesGrid } from '@/components/partner/businesses-grid'

export const dynamic = 'force-dynamic'

// The company's Businesses — the center of gravity. A premium card grid of every business the owner runs.
export default async function BusinessesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const econ = await resolvePartnerEconomics(ctx.partnerId)
  if (econ.billingMode !== 'white_label' && econ.billingMode !== 'reseller') redirect('/partner')

  const { new: isNew } = await searchParams
  const [businesses, clients] = await Promise.all([
    getBusinesses(ctx.partnerId),
    getPartnerClients(ctx.partnerId),
  ])
  const summary = computeWholesaleSummary(clients)

  return (
    <BusinessesGrid
      businesses={businesses}
      wizard={{ book: econ.priceBook ?? null, discount: econ.customWholesaleDiscountPct, markup: econ.retailMarkupPct }}
      autoNew={isNew === '1'}
      mrrCents={summary.monthly_retail_cents}
    />
  )
}

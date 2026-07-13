import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getPartnerContext } from '@/lib/partner/rbac'
import { getPartnerBalanceSummary } from '@/lib/billing/summary'
import { getPlatformFeeSummary } from '@/lib/billing/platform-summary'
import { PageHeader } from '@/components/partner/ui'
import { PlatformFeePanel } from '@/components/partner/platform-fee-panel'
import BalanceConsole from '@/components/partner/balance-console'

export const dynamic = 'force-dynamic'

export default async function BalancePage() {
  const ctx = await getPartnerContext()
  if (!ctx) redirect('/partner/login')
  // Two SEPARATE billing systems, shown in two sections that never mix: the usage wallet (top-ups /
  // metered provider usage) and the platform subscription ($97/mo per active client, on your card).
  const [summary, platform] = await Promise.all([
    getPartnerBalanceSummary(ctx.partnerId),
    getPlatformFeeSummary(ctx.partnerId),
  ])
  return (
    <div className="space-y-10">
      <div>
        <PageHeader title="Balance" subtitle="Fund your account and track usage across every service." />
        <Suspense>
          <BalanceConsole initial={summary} />
        </Suspense>
      </div>
      <div>
        <PageHeader title="Platform Subscription" subtitle="Your $97/month per active client — billed to your card, separate from your usage balance." />
        <PlatformFeePanel summary={platform} />
      </div>
    </div>
  )
}

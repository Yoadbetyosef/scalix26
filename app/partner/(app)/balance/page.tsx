import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getPartnerContext } from '@/lib/partner/rbac'
import { getPartnerBalanceSummary } from '@/lib/billing/summary'
import { PageHeader } from '@/components/partner/ui'
import BalanceConsole from '@/components/partner/balance-console'

export const dynamic = 'force-dynamic'

export default async function BalancePage() {
  const ctx = await getPartnerContext()
  if (!ctx) redirect('/partner/login')
  const summary = await getPartnerBalanceSummary(ctx.partnerId)
  return (
    <div>
      <PageHeader title="Balance" subtitle="Fund your account and track usage across every service." />
      <Suspense>
        <BalanceConsole initial={summary} />
      </Suspense>
    </div>
  )
}

import { getPartnerContext } from '@/lib/partner/rbac'
import { PageHeader } from '@/components/partner/ui'
import { AnalyticsView } from '@/components/partner/analytics-view'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  return (
    <div>
      <PageHeader title="Analytics" subtitle="Your funnel, earnings over time, and best-performing links." />
      <AnalyticsView />
    </div>
  )
}

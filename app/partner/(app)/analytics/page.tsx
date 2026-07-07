import { PageHeader } from '@/components/partner/ui'
import { ComingSoon } from '@/components/partner/coming-soon'

export const dynamic = 'force-dynamic'

export default function AnalyticsPage() {
  return (
    <div>
      <PageHeader title="Analytics" subtitle="Revenue, conversion, and performance insights." />
      <ComingSoon title="Advanced analytics is being built" blurb="Revenue by source, CAC, LTV, funnel, and forecasting are coming next." />
    </div>
  )
}

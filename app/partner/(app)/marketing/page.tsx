import { getPartnerContext } from '@/lib/partner/rbac'
import { PageHeader } from '@/components/partner/ui'
import { MarketingOS } from '@/components/partner/marketing-os'

export const dynamic = 'force-dynamic'

export default async function MarketingPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  return (
    <div>
      <PageHeader title="Marketing" subtitle="Grow your company — campaigns, creatives, and full-funnel ROI." />
      <MarketingOS />
    </div>
  )
}

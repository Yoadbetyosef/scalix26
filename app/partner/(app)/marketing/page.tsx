import { getPartnerContext } from '@/lib/partner/rbac'
import { PageHeader } from '@/components/partner/ui'
import { MarketingLibrary } from '@/components/partner/marketing-library'
import { RoiCalculator } from '@/components/partner/roi-calculator'

export const dynamic = 'force-dynamic'

export default async function MarketingPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  return (
    <div className="space-y-6">
      <PageHeader title="Marketing Center" subtitle="Ready-to-use assets and tools to help you sell faster." />
      <RoiCalculator />
      <MarketingLibrary />
    </div>
  )
}

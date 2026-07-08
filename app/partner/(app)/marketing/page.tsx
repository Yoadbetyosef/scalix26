import { getPartnerContext } from '@/lib/partner/rbac'
import { PageHeader } from '@/components/partner/ui'
import { MarketingLibrary } from '@/components/partner/marketing-library'

export const dynamic = 'force-dynamic'

export default async function MarketingPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  return (
    <div>
      <PageHeader title="Marketing Center" subtitle="Ready-to-use assets to help you sell faster." />
      <MarketingLibrary />
    </div>
  )
}

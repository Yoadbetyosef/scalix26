import { PageHeader } from '@/components/partner/ui'
import { ComingSoon } from '@/components/partner/coming-soon'

export const dynamic = 'force-dynamic'

export default function MarketplaceSettingsPage() {
  return (
    <div>
      <PageHeader title="Marketplace" subtitle="Your public profile in the certified partner directory." />
      <ComingSoon title="Marketplace profiles are being built" blurb="List your agency, showcase specialties and reviews, and get discovered by customers." />
    </div>
  )
}

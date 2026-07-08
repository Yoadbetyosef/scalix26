import { getPartnerContext, canEditMarketplace } from '@/lib/partner/rbac'
import { PageHeader } from '@/components/partner/ui'
import { MarketplaceEditor } from '@/components/partner/marketplace-editor'

export const dynamic = 'force-dynamic'

export default async function MarketplaceSettingsPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  return (
    <div>
      <PageHeader title="Marketplace" subtitle="Your public profile in the certified partner directory." />
      <MarketplaceEditor canEdit={canEditMarketplace(ctx)} slug={ctx.slug} />
    </div>
  )
}

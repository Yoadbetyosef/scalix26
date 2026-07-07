import { PageHeader } from '@/components/partner/ui'
import { ComingSoon } from '@/components/partner/coming-soon'

export const dynamic = 'force-dynamic'

export default function MarketingPage() {
  return (
    <div>
      <PageHeader title="Marketing Center" subtitle="Ready-to-use assets to help you sell." />
      <ComingSoon title="Marketing library is being built" blurb="Searchable, downloadable decks, scripts, one-pagers, and social content are coming next." />
    </div>
  )
}

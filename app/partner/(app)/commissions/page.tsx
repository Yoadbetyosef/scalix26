import { getPartnerContext } from '@/lib/partner/rbac'
import { resolvePartnerEconomics } from '@/lib/partner/economics-resolve'
import { PageHeader } from '@/components/partner/ui'
import { CommissionsView } from '@/components/partner/commissions-view'

export const dynamic = 'force-dynamic'

export default async function CommissionsPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const econ = await resolvePartnerEconomics(ctx.partnerId)
  const wholesale = econ.billingMode === 'white_label' || econ.billingMode === 'reseller'
  return (
    <div>
      <PageHeader
        title={wholesale ? 'Partner Economics' : 'Commissions'}
        subtitle={wholesale ? 'Your price book, client revenue, margin, and agreement.' : 'Your earnings ledger and payout history.'}
      />
      <CommissionsView />
    </div>
  )
}

import { getPartnerContext } from '@/lib/partner/rbac'
import { PageHeader } from '@/components/partner/ui'
import { CommissionsView } from '@/components/partner/commissions-view'

export const dynamic = 'force-dynamic'

export default async function CommissionsPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  return (
    <div>
      <PageHeader title="Commissions" subtitle="Your earnings ledger and payout history." />
      <CommissionsView />
    </div>
  )
}

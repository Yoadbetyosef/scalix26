import { getPartnerContext } from '@/lib/partner/rbac'
import { PageHeader } from '@/components/partner/ui'
import { Academy } from '@/components/partner/academy'

export const dynamic = 'force-dynamic'

export default async function LearningPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  return (
    <div>
      <PageHeader title="Academy" subtitle="Learn to sell Scalix26 and earn your Certified Partner badge." />
      <Academy />
    </div>
  )
}

import { getPartnerContext } from '@/lib/partner/rbac'
import { PageHeader } from '@/components/partner/ui'
import { ReferralManager } from '@/components/partner/referral-manager'

export const dynamic = 'force-dynamic'

export default async function ReferralsPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  // The public origin for building shareable links (from request headers on the server render).
  return (
    <div>
      <PageHeader title="Referrals" subtitle="Share your links. Every signup through them is attributed to you." />
      <ReferralManager />
    </div>
  )
}

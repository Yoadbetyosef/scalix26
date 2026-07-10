import { redirect } from 'next/navigation'
import { getPartnerContext } from '@/lib/partner/rbac'
import { resolvePartnerEconomics } from '@/lib/partner/economics-resolve'
import { PageHeader } from '@/components/partner/ui'
import { WholesaleInfrastructure } from '@/components/partner/wholesale-infrastructure'

export const dynamic = 'force-dynamic'

export default async function InfrastructurePage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const econ = await resolvePartnerEconomics(ctx.partnerId)
  if (econ.billingMode !== 'white_label' && econ.billingMode !== 'reseller') redirect('/partner')
  return (
    <div>
      <PageHeader title="Infrastructure" subtitle="Your own Twilio, OpenAI, ElevenLabs & email — Scalix provisions on them." />
      <WholesaleInfrastructure />
    </div>
  )
}

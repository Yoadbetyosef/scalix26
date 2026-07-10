import { redirect } from 'next/navigation'
import { getPartnerContext } from '@/lib/partner/rbac'
import { resolvePartnerEconomics } from '@/lib/partner/economics-resolve'
import { PageHeader } from '@/components/partner/ui'
import { WholesaleSetupWizard } from '@/components/partner/wholesale-setup-wizard'

export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const econ = await resolvePartnerEconomics(ctx.partnerId)
  if (econ.billingMode !== 'white_label' && econ.billingMode !== 'reseller') redirect('/partner')
  return (
    <div>
      <PageHeader title="Set up your AI company" subtitle="Business, infrastructure, pricing — then launch." />
      <WholesaleSetupWizard />
    </div>
  )
}

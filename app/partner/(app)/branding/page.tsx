import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getPartnerContext } from '@/lib/partner/rbac'
import { resolvePartnerEconomics } from '@/lib/partner/economics-resolve'
import { PageHeader } from '@/components/partner/ui'
import { WholesaleBranding } from '@/components/partner/wholesale-branding'

export const dynamic = 'force-dynamic'

export default async function BrandingPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const econ = await resolvePartnerEconomics(ctx.partnerId)
  if (econ.billingMode !== 'white_label' && econ.billingMode !== 'reseller') redirect('/partner')
  const appHost = (await headers()).get('host') || 'app.scalix26.com'
  return (
    <div>
      <PageHeader title="Branding" subtitle="Make the platform yours — your clients never see Scalix." />
      <WholesaleBranding appHost={appHost} />
    </div>
  )
}

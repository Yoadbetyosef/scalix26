import { redirect } from 'next/navigation'
import { getPartnerContext } from '@/lib/partner/rbac'
import { resolvePartnerEconomics } from '@/lib/partner/economics-resolve'
import { PageHeader } from '@/components/partner/ui'
import { WholesaleClients } from '@/components/partner/wholesale-clients'

export const dynamic = 'force-dynamic'

export default async function ClientsPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const econ = await resolvePartnerEconomics(ctx.partnerId)
  if (econ.billingMode !== 'white_label' && econ.billingMode !== 'reseller') redirect('/partner')
  return (
    <div>
      <PageHeader title="Client Accounts" subtitle="Every business you manage — pricing, margin, and status." />
      <WholesaleClients mode={econ.billingMode} />
    </div>
  )
}

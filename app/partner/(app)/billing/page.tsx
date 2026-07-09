import { redirect } from 'next/navigation'
import { getPartnerContext } from '@/lib/partner/rbac'
import { resolvePartnerEconomics } from '@/lib/partner/economics-resolve'
import { PageHeader } from '@/components/partner/ui'
import { WholesaleBilling } from '@/components/partner/wholesale-billing'

export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const econ = await resolvePartnerEconomics(ctx.partnerId)
  if (econ.billingMode !== 'white_label' && econ.billingMode !== 'reseller') redirect('/partner')
  return (
    <div>
      <PageHeader title="Billing" subtitle="Your wholesale balance, invoices, and agreement." />
      <WholesaleBilling mode={econ.billingMode} />
    </div>
  )
}

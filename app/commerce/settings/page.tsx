import { ConfigView } from '@/components/commerce/config-view'
import { ProposalBrandingSettings } from '@/components/commerce/proposal-branding-settings'
import { CommerceInvoiceSettings } from '@/components/commerce/commerce-invoice-settings'
export const metadata = { title: 'Commerce settings' }
export default function Page() {
  return (
    <div className="space-y-8">
      <ConfigView />
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 sm:px-6">
        <div className="rounded-card border border-hairline bg-surface p-5 shadow-e1"><CommerceInvoiceSettings /></div>
        <div className="rounded-card border border-hairline bg-surface p-5 shadow-e1"><ProposalBrandingSettings /></div>
      </div>
    </div>
  )
}

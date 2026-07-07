import { getPartnerContext, canCreateDemos } from '@/lib/partner/rbac'
import { PageHeader } from '@/components/partner/ui'
import { DemoManager } from '@/components/partner/demo-manager'

export const dynamic = 'force-dynamic'

export default async function DemosPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  return (
    <div>
      <PageHeader title="Demos" subtitle="Generate a personalized, shareable AI demo for any prospect in seconds." />
      <DemoManager canCreate={canCreateDemos(ctx)} />
    </div>
  )
}

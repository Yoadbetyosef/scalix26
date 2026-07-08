import { getPartnerContext, canEditPipeline } from '@/lib/partner/rbac'
import { PageHeader } from '@/components/partner/ui'
import { PipelineBoard } from '@/components/partner/pipeline-board'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  return (
    <div>
      <PageHeader title="Pipeline" subtitle="Track every prospect from lead to won." />
      <PipelineBoard canEdit={canEditPipeline(ctx)} />
    </div>
  )
}

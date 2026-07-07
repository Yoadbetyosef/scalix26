import { PageHeader } from '@/components/partner/ui'
import { ComingSoon } from '@/components/partner/coming-soon'

export const dynamic = 'force-dynamic'

export default function PipelinePage() {
  return (
    <div>
      <PageHeader title="Pipeline" subtitle="Your sales CRM — leads, stages, and follow-ups." />
      <ComingSoon title="CRM pipeline is being built" blurb="Kanban stages, activity timeline, CSV import, and rep assignment land in the next release." />
    </div>
  )
}

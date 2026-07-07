import { PageHeader } from '@/components/partner/ui'
import { ComingSoon } from '@/components/partner/coming-soon'

export const dynamic = 'force-dynamic'

export default function LearningPage() {
  return (
    <div>
      <PageHeader title="Academy" subtitle="Learn to sell Scalix26 and get certified." />
      <ComingSoon title="The Academy is being built" blurb="Video lessons, certification exams, badges, and a leaderboard are coming next." />
    </div>
  )
}

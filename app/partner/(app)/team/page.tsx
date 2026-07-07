import { redirect } from 'next/navigation'
import { getPartnerContext, canManageTeam, supportsTeams } from '@/lib/partner/rbac'
import { PageHeader } from '@/components/partner/ui'
import { TeamManager } from '@/components/partner/team-manager'

export const dynamic = 'force-dynamic'

export default async function TeamPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  if (!supportsTeams(ctx.partnerType)) redirect('/partner')
  return (
    <div>
      <PageHeader title="Team" subtitle="Invite teammates and assign roles." />
      <TeamManager canManage={canManageTeam(ctx)} />
    </div>
  )
}

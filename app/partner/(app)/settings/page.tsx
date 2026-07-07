import { getPartnerContext, canManageTeam, canManageApiKeys, supportsTeams } from '@/lib/partner/rbac'
import { PageHeader } from '@/components/partner/ui'
import { TeamManager } from '@/components/partner/team-manager'
import { ApiKeysManager } from '@/components/partner/api-keys-manager'

export const dynamic = 'force-dynamic'

export default async function PartnerSettingsPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null

  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage your team, API access, and partner profile." />
      <div className="space-y-6">
        {supportsTeams(ctx.partnerType) && <TeamManager canManage={canManageTeam(ctx)} />}
        <ApiKeysManager canManage={canManageApiKeys(ctx)} />
      </div>
    </div>
  )
}

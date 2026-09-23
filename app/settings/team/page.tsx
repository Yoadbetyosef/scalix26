import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { listMembers } from '@/lib/team/members'
import { TeamClient } from '@/components/settings/team-client'

export const metadata = { title: 'Team' }

// WHO CAN GET INTO THIS BUSINESS.
//
// Owner-only, and the gate is capabilities.canManageTeam rather than a role comparison, so the rule
// lives in lib/team/roles.ts with every other answer to "may she?" — /api/team re-checks the same
// capability, which is what actually protects the data.
//
// A staff member who types the URL is sent to the dashboard rather than shown an error: she has done
// nothing wrong, the page simply isn't hers, and a refusal screen for a link she was never offered is
// just noise.
export default async function TeamPage() {
  const ctx = await requireActiveBusinessContext()
  if (!ctx) redirect('/auth/login')
  if (!ctx.capabilities.canManageTeam) redirect('/dashboard')

  const [{ members, unavailable }, { data: tenant }] = await Promise.all([
    listMembers(ctx.tenantId),
    createAdminClient().from('tenants').select('business_name').eq('id', ctx.tenantId).maybeSingle(),
  ])

  return (
    <TeamClient
      members={members}
      businessName={tenant?.business_name || 'your business'}
      currentUserId={ctx.actorUserId}
      migrationMissing={unavailable}
    />
  )
}

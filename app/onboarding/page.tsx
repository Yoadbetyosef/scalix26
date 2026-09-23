import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getActiveWorkspace } from '@/lib/workspace'

// The separate onboarding wizard is retired. Onboarding now happens on the full AI
// employee edit page. Any hit here routes to that single experience: the first agent's
// edit page if one exists, otherwise the New Employee path (which creates + provisions
// + lands on the same full page).
export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // The ACTIVE workspace, not tenants.user_id. A team member owns no tenant, so the old lookup sent
  // her to /setup — the one screen whose whole job is to create a business — and the tenant it made
  // would have outranked her membership. Onboarding belongs to whoever's business this is.
  const ws = await getActiveWorkspace()
  if (!ws.tenantId) redirect('/setup')
  const tenant = { id: ws.tenantId }

  const serviceSupabase = createAdminClient()
  const { data: agent } = await serviceSupabase
    .from('ai_employees').select('id').eq('tenant_id', tenant.id)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()

  if (agent) redirect(`/ai-employees/${agent.id}?onboarding=1`)
  redirect('/ai-employees/new')
}

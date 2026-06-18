import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

// The separate onboarding wizard is retired. Onboarding now happens on the full AI
// employee edit page. Any hit here routes to that single experience: the first agent's
// edit page if one exists, otherwise the New Employee path (which creates + provisions
// + lands on the same full page).
export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const serviceSupabase = await createServiceClient()
  const { data: tenant } = await serviceSupabase
    .from('tenants').select('id').eq('user_id', user.id).limit(1).maybeSingle()
  if (!tenant) redirect('/setup')

  const { data: agent } = await serviceSupabase
    .from('ai_employees').select('id').eq('tenant_id', tenant.id)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()

  if (agent) redirect(`/ai-employees/${agent.id}?onboarding=1`)
  redirect('/ai-employees/new')
}

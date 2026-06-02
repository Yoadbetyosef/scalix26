import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const serviceSupabase = await createServiceClient()
  const { data: tenant } = await serviceSupabase
    .from('tenants')
    .select('*')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!tenant) redirect('/setup')

  const { data: employees } = await serviceSupabase
    .from('ai_employees')
    .select('id')
    .eq('tenant_id', tenant.id)
    .limit(1)

  if (employees && employees.length > 0) redirect('/dashboard')

  const { data: channels } = await serviceSupabase
    .from('channels')
    .select('type, twilio_number, status')
    .eq('tenant_id', tenant.id)

  return <OnboardingFlow tenant={tenant} channels={channels || []} />
}

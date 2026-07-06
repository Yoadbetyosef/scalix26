import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AvailabilityClient } from '@/components/settings/availability-client'
import { ModuleDisabled } from '@/components/app/module-disabled'
import { moduleEnabled } from '@/lib/modules'

export default async function AvailabilityPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const service = await createServiceClient()
  const { data: tenant } = await service
    .from('tenants')
    .select('id, google_review_url, review_automation_enabled, enabled_modules')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!tenant) redirect('/auth/signup')
  if (!moduleEnabled(tenant, 'scheduling')) return <ModuleDisabled name="Scheduling" />

  return (
    <AvailabilityClient
      tenantId={tenant.id}
      googleReviewUrl={tenant.google_review_url || ''}
      reviewEnabled={tenant.review_automation_enabled ?? true}
    />
  )
}

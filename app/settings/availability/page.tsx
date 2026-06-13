import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AvailabilityClient } from '@/components/settings/availability-client'

export default async function AvailabilityPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const service = await createServiceClient()
  const { data: tenant } = await service
    .from('tenants')
    .select('id, google_review_url, review_automation_enabled')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!tenant) redirect('/auth/signup')

  const { data: slots } = await service
    .from('appointment_slots')
    .select('day_of_week, slot_time')
    .eq('tenant_id', tenant.id)

  return (
    <AvailabilityClient
      tenantId={tenant.id}
      initialSlots={slots || []}
      googleReviewUrl={tenant.google_review_url || ''}
      reviewEnabled={tenant.review_automation_enabled ?? true}
    />
  )
}

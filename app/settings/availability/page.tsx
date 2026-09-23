import { createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { AvailabilityClient } from '@/components/settings/availability-client'
import { ModuleDisabled } from '@/components/app/module-disabled'
import { moduleEnabled } from '@/lib/modules'

// Resolved through the active-workspace context rather than `tenants.user_id`. The old lookup sent
// anybody who does not personally own a tenant — every team member — to /auth/signup, which reads as
// "you have no account" to somebody who plainly does. canEditSettings then decides whether this
// particular colleague may change the business's settings at all.
export default async function AvailabilityPage() {
  const ctx = await requireActiveBusinessContext()
  if (!ctx) redirect('/auth/login')
  if (!ctx.capabilities.canEditSettings) redirect('/dashboard')

  const { data: tenant } = await createAdminClient()
    .from('tenants')
    .select('id, google_review_url, review_automation_enabled, enabled_modules')
    .eq('id', ctx.tenantId)
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

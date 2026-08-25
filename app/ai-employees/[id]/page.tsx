import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { readAgentEditorData } from '@/lib/agents/editor-read'
import { redirect, notFound } from 'next/navigation'
import { AIEmployeeEditClient } from '@/components/ai-employees/ai-employee-edit-client'
import { BusinessIntelligenceProgress } from '@/components/ai-employees/business-intelligence-progress'

export default async function AIEmployeeEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string>>
}) {
  const { id } = await params
  const sp = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Operator-safe by construction: readAgentEditorData opens its own admin client (not
  // createServiceClient, which would RLS-scope to the partner's own tenant) and takes the
  // server-validated tenantId as its sole scope. An unused createAdminClient() binding sat here
  // before the migration; it went with the import rather than staying to fail lint.
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/setup')
  // Moved to lib/agents/editor-read.ts so /v2's agent screen reads the same rows. Same queries, same
  // joins, same ordering — see that file's header.
  const data = await readAgentEditorData(tenantId, id)
  if (!data) notFound()
  const { tenant, slots, employee, businessDetails, knowledgeBase, emailAccounts } = data

  return (
    <div className="flex flex-col p-4 sm:p-6 w-full max-w-3xl overflow-x-clip">
      {/* Real-data intelligence bar — shows the website scan + business data being pulled.
          A3: on mobile these two cards render BELOW the identity header (which lives inside
          the client). CSS order pushes them after the client on mobile only; desktop keeps
          the original top-of-page order (md:order-none). */}
      <div className="mb-4 max-md:order-2">
        <BusinessIntelligenceProgress agentId={id} name={employee.name || 'Your AI employee'} />
      </div>
      <AIEmployeeEditClient
        employee={employee}
        tenantId={tenant.id}
        tenantSlug={tenant.slug || ''}
        businessDetails={businessDetails}
        knowledgeBase={knowledgeBase}
        metaConnected={sp.meta_connected === 'true'}
        metaError={sp.meta_error}
        emailAccounts={emailAccounts || []}
        googleConnected={sp.google_connected === 'true'}
        googleError={sp.google_error}
        onboarding={sp.onboarding === '1'}
        skills={(employee.skills as { type: string; active: boolean }[]) || []}
        availabilitySlots={(slots as { day_of_week: number; slot_time: string }[]) || []}
        googleReviewUrl={tenant.google_review_url || ''}
        reviewEnabled={tenant.review_automation_enabled ?? true}
      />
    </div>
  )
}

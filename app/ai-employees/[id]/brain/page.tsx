import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { redirect, notFound } from 'next/navigation'
import { BusinessBrain } from '@/components/ai-employees/business-brain'

export default async function BusinessBrainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Admin client (operator-safe; createServiceClient would RLS-scope to the partner's own tenant).
  const service = createAdminClient()
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/setup')
  const { data: employee } = await service.from('ai_employees').select('id, name').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (!employee) notFound()

  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <BusinessBrain agentId={id} agentName={employee.name || 'your AI employee'} />
    </div>
  )
}

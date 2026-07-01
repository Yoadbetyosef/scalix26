import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { BusinessBrain } from '@/components/ai-employees/business-brain'

export default async function BusinessBrainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const service = await createServiceClient()
  const { data: tenant } = await service.from('tenants').select('id').eq('user_id', user.id).limit(1).maybeSingle()
  if (!tenant) redirect('/setup')
  const { data: employee } = await service.from('ai_employees').select('id, name').eq('id', id).eq('tenant_id', tenant.id).maybeSingle()
  if (!employee) notFound()

  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <BusinessBrain agentId={id} agentName={employee.name || 'your AI employee'} />
    </div>
  )
}

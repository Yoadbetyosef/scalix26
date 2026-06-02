import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { AIEmployeeEditClient } from '@/components/ai-employees/ai-employee-edit-client'

export default async function AIEmployeeEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const serviceSupabase = await createServiceClient()
  const { data: tenant } = await serviceSupabase
    .from('tenants').select('id').eq('user_id', user.id).limit(1).maybeSingle()
  if (!tenant) redirect('/setup')

  const { data: employee } = await serviceSupabase
    .from('ai_employees')
    .select('*, skills(*), channels(*)')
    .eq('id', id)
    .eq('tenant_id', tenant.id)
    .single()

  if (!employee) notFound()

  return (
    <div className="p-6 max-w-3xl">
      <AIEmployeeEditClient employee={employee} tenantId={tenant.id} />
    </div>
  )
}

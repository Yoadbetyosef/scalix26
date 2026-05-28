import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AIEmployeeWizard } from '@/components/wizard/ai-employee-wizard'

export default async function NewAIEmployeePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!tenant) redirect('/setup')

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      <AIEmployeeWizard tenant={tenant} />
    </div>
  )
}

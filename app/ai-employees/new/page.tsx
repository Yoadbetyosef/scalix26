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
    .single()

  if (!tenant) redirect('/auth/signup')

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      <AIEmployeeWizard tenant={tenant} />
    </div>
  )
}

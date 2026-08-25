import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NewEmployeeLauncher } from '@/components/ai-employees/new-employee-launcher'

// "Create another AI employee" now uses the SAME edit-page experience as onboarding:
// create + provision via /api/agents/create, then land on /ai-employees/{id}?onboarding=1.
// (Retires the old separate 5-step wizard.)
export default async function NewAIEmployeePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return (
    <NewEmployeeLauncher />
  )
}

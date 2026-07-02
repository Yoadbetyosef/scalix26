import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/admin/auth'
import { createClient } from '@/lib/supabase/server'
import { MetaReviewDemoClient } from '@/components/admin/meta-review-demo-client'

// Temporary admin-only page for the Meta App Review screencast. Removable after approval.
export default async function MetaReviewDemoPage() {
  if (!(await isAdmin())) redirect('/dashboard')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user!.id).single()
  const { data: agents } = await supabase.from('ai_employees').select('id').eq('tenant_id', tenant?.id || '').limit(1)
  const agentId = agents?.[0]?.id ?? null
  return <MetaReviewDemoClient agentId={agentId} />
}

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BusinessInfoClient } from '@/components/settings/business-info-client'

export default async function BusinessInfoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const service = await createServiceClient()
  const { data: tenant } = await service
    .from('tenants').select('id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant) redirect('/auth/signup')

  const { data: rows } = await service
    .from('knowledge_base')
    .select('title, content')
    .eq('tenant_id', tenant.id)
    .eq('source', 'template')
    .is('ai_employee_id', null)

  const initial: Record<string, string> = {}
  for (const r of rows || []) initial[r.title] = r.content

  return <BusinessInfoClient tenantId={tenant.id} initial={initial} />
}

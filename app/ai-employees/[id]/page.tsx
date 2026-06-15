import { createClient, createServiceClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { AIEmployeeEditClient } from '@/components/ai-employees/ai-employee-edit-client'

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

  const serviceSupabase = await createServiceClient()
  const { data: tenant } = await serviceSupabase
    .from('tenants').select('id, slug').eq('user_id', user.id).limit(1).maybeSingle()
  if (!tenant) redirect('/setup')

  const { data: employee } = await serviceSupabase
    .from('ai_employees')
    .select('*, skills(*), channels(*)')
    .eq('id', id)
    .eq('tenant_id', tenant.id)
    .single()

  if (!employee) notFound()

  const { data: kbRows } = await serviceSupabase
    .from('knowledge_base')
    .select('id, title, content, source')
    .eq('tenant_id', tenant.id)
    .eq('ai_employee_id', id)
    .order('created_at', { ascending: true })

  // Connected OAuth mailbox (Gmail/Workspace) for this agent, if any. Uses the
  // admin client because connected_email_accounts has RLS with no read policy
  // (it holds encrypted tokens — server-only access).
  const { data: emailAccount } = await createAdminClient()
    .from('connected_email_accounts')
    .select('id, provider, email_address, status')
    .eq('ai_employee_id', id)
    .maybeSingle()

  // The 3 fixed Business-Details fields vs everything else (free-form KB).
  const BUSINESS_TITLES = ['Pricing', 'Service Areas', "What We Don't Do"]
  const businessDetails: Record<string, string> = {}
  const knowledgeBase: { id: string; title: string; content: string }[] = []
  for (const r of kbRows || []) {
    if (r.source === 'template' && BUSINESS_TITLES.includes(r.title)) businessDetails[r.title] = r.content
    else knowledgeBase.push({ id: r.id, title: r.title, content: r.content })
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <AIEmployeeEditClient
        employee={employee}
        tenantId={tenant.id}
        tenantSlug={tenant.slug || ''}
        businessDetails={businessDetails}
        knowledgeBase={knowledgeBase}
        metaConnected={sp.meta_connected === 'true'}
        metaError={sp.meta_error}
        emailAccount={emailAccount || null}
        googleConnected={sp.google_connected === 'true'}
        googleError={sp.google_error}
      />
    </div>
  )
}

import { createClient, createServiceClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { GraduationCap } from 'lucide-react'
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
    .from('tenants').select('id, slug, google_review_url, review_automation_enabled').eq('user_id', user.id).limit(1).maybeSingle()
  if (!tenant) redirect('/setup')

  // Availability & reviews (tenant-level) — now edited inline on this page.
  const { data: slots } = await serviceSupabase
    .from('appointment_slots').select('day_of_week, slot_time').eq('tenant_id', tenant.id)

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
  const { data: emailAccounts } = await createAdminClient()
    .from('connected_email_accounts')
    .select('id, provider, email_address, status, is_primary')
    .eq('ai_employee_id', id)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

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
      <Link
        href={`/ai-employees/${id}/playbook`}
        className="mb-4 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-e1 ring-1 ring-hairline transition-all hover:-translate-y-px hover:shadow-e2"
      >
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent-strong">
          <GraduationCap className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">AI Training & Playbook</span>
          <span className="block text-xs text-muted">Teach this employee how you sell, schedule, and handle customers across every channel.</span>
        </span>
        <span className="ml-auto text-muted">›</span>
      </Link>
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

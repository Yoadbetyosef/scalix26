import { notFound } from 'next/navigation'
import { readAgentEditorData } from '@/lib/agents/editor-read'
import { listPageContext } from '../../list-page'
import { AgentClient } from './client'

// One agent, reskinned. readAgentEditorData is the /ai-employees/[id] page's own read, extracted
// verbatim — same queries, same joins, same ordering. No new query.
//
// The props are assembled exactly as the real page assembles them, including the search-param flags,
// so the hook underneath receives what it has always received.

export const dynamic = 'force-dynamic'

export default async function V2Agent({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string>>
}) {
  const { id } = await params
  const sp = await searchParams
  const { tenantId } = await listPageContext()

  const data = await readAgentEditorData(tenantId, id)
  if (!data) notFound()
  const { tenant, slots, employee, businessDetails, knowledgeBase, emailAccounts } = data

  return (
    <AgentClient
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
  )
}

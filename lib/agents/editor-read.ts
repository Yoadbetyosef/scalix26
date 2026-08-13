import { createAdminClient } from '@/lib/supabase/server'
import { agentKnowledgeOrFilter } from '@/lib/knowledge/scope'

// Everything the agent editor renders from, moved here VERBATIM from app/ai-employees/[id]/page.tsx.
//
// Sixth extraction of this kind, same reason: the reads were written inline in a page's render, so
// /v2's agent screen had no way to ask for the same rows. Both pages call this now.
//
// ── THE BODY IS UNCHANGED ───────────────────────────────────────────────────────────────────────────
//
// Extracted programmatically. The edits are mechanical: the admin client is created here rather than
// closed over as `serviceSupabase`, and the verified tenant id is a parameter rather than read off a
// tenant row. Returns null when the agent is missing — notFound() is a routing decision and stays in
// the page, as it did for the contact and conversation reads.

export async function readAgentEditorData(tenantId: string, id: string) {
  const db = createAdminClient()
  const { data: tenant } = await db
    .from('tenants').select('id, slug, google_review_url, review_automation_enabled').eq('id', tenantId).maybeSingle()
  if (!tenant) return null

  // Availability & reviews (tenant-level) — now edited inline on this page.
  const { data: slots } = await db
    .from('appointment_slots').select('day_of_week, slot_time').eq('tenant_id', tenantId)

  const { data: employee } = await db
    .from('ai_employees')
    .select('*, skills(*), channels(*)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()

  if (!employee) return null

  // Business Knowledge is tenant-owned: return tenant-wide (ai_employee_id IS NULL) PLUS this
  // agent's own rows. See lib/knowledge/scope.
  const { data: kbRows } = await db
    .from('knowledge_base')
    .select('id, title, content, source, ai_employee_id')
    .eq('tenant_id', tenantId)
    .or(agentKnowledgeOrFilter(id))
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
  const knowledgeBase: { id: string; title: string; content: string; shared: boolean }[] = []
  for (const r of kbRows || []) {
    if (r.source === 'template' && BUSINESS_TITLES.includes(r.title)) businessDetails[r.title] = r.content
    else knowledgeBase.push({ id: r.id, title: r.title, content: r.content, shared: r.ai_employee_id === null })
  }

  return { tenant, slots: slots ?? [], employee, businessDetails, knowledgeBase, emailAccounts: emailAccounts ?? [] }
}

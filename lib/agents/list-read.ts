import { createAdminClient } from '@/lib/supabase/server'

// The AI employees list, moved here VERBATIM from app/ai-employees/page.tsx.
//
// Fourth extraction of this kind. Same reason: written inline in a page's render, so a second screen
// could not ask for the same rows.
//
// ── THE BODY IS UNCHANGED ───────────────────────────────────────────────────────────────────────────
//
// Extracted programmatically. One mechanical edit: the admin client is created here rather than closed
// over. Both queries, every filter, the join and the ordering are byte-identical, and the email-account
// comment travels with the query it explains.

export interface AgentRow extends Record<string, unknown> {
  id: string
  name: string
  status: string | null
  voice: string | null
  created_at: string
  channels: Array<Record<string, unknown> & { type?: string | null; twilio_number?: string | null }> | null
  skills: Array<Record<string, unknown> & { id: string; active: boolean }> | null
}

export async function readAgents(tenantId: string): Promise<{ employees: AgentRow[]; emailAgentIds: Set<unknown> }> {
  const { data: employees } = await createAdminClient()
    .from('ai_employees')
    .select('*, channels(*), skills(*)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  // Email connection lives in connected_email_accounts (per-agent), NOT in the
  // channels table — so the card's count/badges miss it. Read which agents have a
  // connected email account (admin read, scoped to this verified tenant).
  const { data: emailAccounts } = await createAdminClient()
    .from('connected_email_accounts')
    .select('ai_employee_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'connected')
  const emailAgentIds = new Set((emailAccounts || []).map((a) => a.ai_employee_id).filter(Boolean))

  return { employees: (employees ?? []) as AgentRow[], emailAgentIds }
}

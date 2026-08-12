import { createAdminClient } from '@/lib/supabase/server'
import { getBusinessTimezone } from '@/lib/timezone'

// One conversation, its messages and the tenant's timezone — moved here VERBATIM from
// app/inbox/[id]/page.tsx.
//
// Third extraction of this kind, and the same reason each time: the reads were written inline in a
// page's render, so a second screen could not ask for the same rows. Both pages call this now.
//
// ── THE BODY IS UNCHANGED ───────────────────────────────────────────────────────────────────────────
//
// Extracted programmatically. The edits are mechanical and all about where control flow belongs: the
// admin client is created here rather than closed over, `id` is a parameter rather than read from the
// route, and the two failure cases RETURN NULL instead of calling redirect() and notFound() — those
// are routing decisions and belong to the page. Every filter, every column, the join and the ordering
// are byte-identical.

export interface ConversationRead {
  tz: string
  // Typed as the page already treated them: select('*') on an existing row returns these, and
  // widening channel/status to null here would only push four null-checks into a page whose behaviour
  // is not changing.
  conv: Record<string, unknown> & {
    id: string; channel: string; status: string; summary: string | null
    duration_seconds: number | null
    human_takeover: boolean | null; sentiment?: string; created_at: string; updated_at: string | null
    contact: { id: string; name?: string; phone?: string; email?: string; address?: string } | null
    ai_employee: { name: string } | null
  }
  messages: Array<Record<string, unknown> & {
    id: string; direction: string | null; content: string | null; timestamp: string
    channel: string | null; status: string | null
  }>
}

export async function readConversation(tenantId: string, id: string): Promise<ConversationRead | null> {
  const service = createAdminClient()
  const { data: tenant } = await service.from('tenants').select('id, timezone').eq('id', tenantId).maybeSingle()
  if (!tenant) return null

  // Conversation/message times shown in the tenant's business timezone (same source
  // the agent/booking use), consistent with the inbox list.
  const tz = await getBusinessTimezone(tenant.id, tenant.timezone)

  const { data: conv } = await service
    .from('conversations')
    .select('*, contact:contacts(*), ai_employee:ai_employees(name)')
    .eq('id', id)
    .eq('tenant_id', tenant.id)
    .single()

  if (!conv) return null

  const { data: messages } = await service
    .from('messages')
    .select('*')
    .eq('conversation_id', id)
    .order('timestamp', { ascending: true })

  return {
    tz,
    conv: conv as ConversationRead['conv'],
    messages: (messages ?? []) as ConversationRead['messages'],
  }
}

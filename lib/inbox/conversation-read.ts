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
  conv: ConversationRow
  messages: MessageRow[]
}

// ── THE COLUMNS, ONCE ────────────────────────────────────────────────────────────────────────────
//
// `select('*')` with a `Record<string, unknown> &` type is how a screen ends up reading fields that
// do not exist. This file declared `direction` and `status` on a message; the table has neither, so
// `m.direction === 'inbound'` was never true and every customer message rendered as the agent's, and
// `m.status === 'failed'` never marked an undelivered one. It joined `ai_employees(name)` while the
// screen read `.persona`, so every thread wore the phone employee's colours.
//
// Nothing failed. `select('*')` returns whatever exists, the intersection type accepted any key, and
// tsc had nothing to check the names against.
//
// So: the columns are named, the types are EXACT — no index signature to absorb a typo — and a test
// asserts every declared field appears in the select list it is read from. A name that is not a
// column now fails at the query, loudly, instead of being quietly undefined for a year.
export const CONV_COLS = 'id, channel, status, summary, recap, duration_seconds, human_takeover, sentiment, created_at, updated_at, ai_employee_id'
export const CONTACT_COLS = 'id, name, phone, email, address'
export const AGENT_COLS = 'name, persona'
export const MESSAGE_COLS = 'id, conversation_id, role, content, timestamp, channel, delivery_status, error_code'

export interface ConversationRow {
  id: string
  channel: string
  status: string
  /** On EMAIL this is the subject line, written by the inbound webhook and read back by /send as the
   *  outbound Subject header. It is not a recap and must not be shown as one. */
  summary: string | null
  /** The written account of what happened, or null until the conversation completes. */
  recap: string | null
  duration_seconds: number | null
  human_takeover: boolean | null
  sentiment: string | null
  created_at: string
  updated_at: string | null
  ai_employee_id: string | null
  contact: { id: string; name: string | null; phone: string | null; email: string | null; address: string | null } | null
  /** `persona` is joined because the thread paints in that employee's own colours. */
  ai_employee: { name: string | null; persona: string | null } | null
}

export interface MessageRow {
  id: string
  conversation_id: string
  /** THE authorship field, and the only one. user = the customer, assistant = the AI, agent = a person. */
  role: string | null
  content: string | null
  timestamp: string
  channel: string | null
  /** null until a provider callback resolves it; 'failed' / 'undelivered' / 'billing_blocked' after. */
  delivery_status: string | null
  error_code: string | null
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
    .select(`${CONV_COLS}, contact:contacts(${CONTACT_COLS}), ai_employee:ai_employees(${AGENT_COLS})`)
    .eq('id', id)
    .eq('tenant_id', tenant.id)
    .single()

  if (!conv) return null

  const { data: messages } = await service
    .from('messages')
    .select(MESSAGE_COLS)
    .eq('conversation_id', id)
    .order('timestamp', { ascending: true })

  return {
    tz,
    conv: conv as unknown as ConversationRow,
    messages: (messages ?? []) as unknown as MessageRow[],
  }
}

import { createAdminClient } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/contacts/store'
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

/** What the leads screen carried, moved onto the thread it was always about. */
export interface Origin {
  /** How this person first reached the business: 'voice_call', 'web_form', … Raw, labelled by the UI. */
  source: string | null
  /** Follow-up sequences still running for them. A control that stops nothing must not be offered. */
  activeFollowUps: number
  /** The lead rows this person has open, so stopping them needs no second lookup. */
  openLeadIds: string[]
}

export interface ConversationRead {
  tz: string
  conv: ConversationRow
  messages: MessageRow[]
  origin: Origin
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
    origin: await readOrigin(service, tenant.id, (conv as unknown as ConversationRow).contact?.id ?? null),
  }
}

/**
 * WHERE THEY CAME FROM, AND WHETHER ANYTHING IS STILL CHASING THEM.
 *
 * Both from `leads`, which is staying exactly as it is — fifteen consumers read that table and none
 * of them read the screen that is going. What moves is the two facts onto the thread they describe.
 *
 * The EARLIEST lead is the source: a returning customer opens a new lead every time they call, so the
 * newest one says "phone call" about somebody who first found you through a web form a year ago.
 */
async function readOrigin(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
  contactId: string | null,
): Promise<Origin> {
  const empty: Origin = { source: null, activeFollowUps: 0, openLeadIds: [] }
  if (!contactId) return empty
  try {
    const { data: leads } = await db
      .from('leads')
      .select('id, source, status, phone, created_at')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
    const rows = (leads ?? []) as { id: string; source: string | null; status: string; phone: string | null }[]
    if (!rows.length) return empty

    const open = rows.filter((l) => l.status === 'new' || l.status === 'contacted' || l.status === 'called_back')
    const phones = [...new Set(rows.map((l) => normalizePhone(l.phone)).filter(Boolean))]

    let activeFollowUps = 0
    if (phones.length) {
      const { data: drips } = await db
        .from('drip_campaigns')
        .select('contact_phone')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
      // Normalised, for the same reason the brake is: contact_phone holds whatever reached intake.
      activeFollowUps = ((drips ?? []) as { contact_phone: string | null }[])
        .filter((d) => phones.includes(normalizePhone(d.contact_phone))).length
    }

    return { source: rows[0].source, activeFollowUps, openLeadIds: open.map((l) => l.id) }
  } catch (err) {
    // The thread renders without it. An origin lookup is not worth a blank conversation.
    console.error('[conversation-read] origin failed:', err instanceof Error ? err.message : err)
    return empty
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyReply, type AutonomyRule } from './autonomy'
import { groundedFor } from './grounding'
import { hold } from './drafts'
import { notifyOwner } from './notify'
import { nameOf } from '@/lib/persona'

// WHERE A REPLY STOPS.
//
// Every inbound path is the same three steps: work out what to say, say it, record it. This sits
// between the first and the second, and only for the employee who owns messages.
//
// ── IT DOES NOTHING UNLESS MILES IS THE AGENT ───────────────────────────────────────────────────────
//
// The gate is the persona on the row that answered, not an environment flag. A tenant that has not
// hired Miles has no agent with persona='miles', so `maybeHold` returns `{ held: false }` before it
// reads anything else and every existing tenant behaves exactly as it did yesterday. That is a
// stronger guarantee than a flag, because it cannot be switched on by accident.
//
// ── A HELD DRAFT IS ANNOUNCED, OR IT IS NOT HELD QUIETLY ────────────────────────────────────────────
//
// If the SMS and the email both fail, the reply STILL does not go out — nothing is sent in the
// owner's name without a decision, and a broken notification is not a decision. What changes is that
// the failure is written to the row (`notify_error`) and shown on the inbox, because the alternative
// is a customer waiting on a message nobody knows exists.

export interface InterceptInput {
  db: SupabaseClient
  tenantId: string
  /** The agent that produced the reply. Absent = the tenant's default agent answered; never Miles. */
  agentId?: string | null
  conversationId: string
  channel: string
  /** What the customer said. */
  inbound: string
  /** What the agent wants to say. */
  reply: string
  /** Set when the reply booked into a slot that already existed — the one date that is not a promise. */
  bookingWithinAvailability?: boolean
}

export interface InterceptResult {
  /** True = do not send. The caller must not deliver the reply. */
  held: boolean
  draftId?: string
  /** Present when the draft was held but the owner could not be told. */
  notifyError?: string
}

const NOT_HELD: InterceptResult = { held: false }

export async function maybeHold(input: InterceptInput): Promise<InterceptResult> {
  const { db, tenantId, agentId, conversationId, channel, inbound, reply } = input
  if (!agentId || !reply?.trim()) return NOT_HELD

  const { data: agent } = await db
    .from('ai_employees')
    .select('id, name, persona, autonomy_rules')
    .eq('id', agentId)
    .maybeSingle()

  // The whole feature hangs off this line. No Miles, no interception.
  if (!agent || agent.persona !== 'miles') return NOT_HELD

  // What this business has actually written down. Scoped the same way the pipeline scopes it: this
  // agent's entries plus the tenant-wide ones.
  const [{ data: kb }, { data: facts }] = await Promise.all([
    db.from('knowledge_base').select('title, content, ai_employee_id').eq('tenant_id', tenantId),
    db.from('ai_employees')
      .select('business_name, industry, address, city, state, zip, business_hours, website')
      .eq('id', agentId).maybeSingle(),
  ])

  const knowledge = (kb ?? [])
    .filter((k) => !k.ai_employee_id || k.ai_employee_id === agentId)
    .map((k) => `${k.title ?? ''} ${k.content ?? ''}`)

  const grounding = groundedFor(inbound, {
    knowledge,
    facts: facts ? Object.values(facts).map((v) => (typeof v === 'string' ? v : JSON.stringify(v ?? ''))) : [],
  })

  const decision = classifyReply({
    reply,
    inbound,
    grounded: grounding.grounded,
    bookingWithinAvailability: input.bookingWithinAvailability,
    rules: (agent.autonomy_rules ?? []) as AutonomyRule[],
  })

  if (decision.verdict === 'send') return NOT_HELD

  // ── THE REPLY WAS ALREADY WRITTEN TO THE TRANSCRIPT ───────────────────────────────────────────────
  //
  // runAIPipeline stores the assistant message before it returns (pipeline.ts, the messages insert),
  // which is correct when the reply is about to be sent and a lie when it is not. A held draft that
  // also appears in the thread would show the customer's own conversation containing words they never
  // received. Scoped as tightly as it can be: this conversation, this exact text, the most recent one.
  const { data: ghost } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('role', 'assistant')
    .eq('content', reply)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (ghost?.id) await db.from('messages').delete().eq('id', ghost.id)

  const { data: conv } = await db
    .from('conversations')
    .select('contact_id, contact:contacts(name, phone, email)')
    .eq('id', conversationId)
    .maybeSingle()

  const draft = await hold(db, {
    tenantId,
    agentId,
    conversationId,
    contactId: conv?.contact_id ?? null,
    channel,
    inboundExcerpt: inbound,
    body: reply,
    reasons: decision.commitments,
  })

  if (!draft) {
    // The insert lost the one-pending-per-conversation race, which means another draft is already
    // waiting on this thread and the owner has already been told about it. Still not sent.
    console.warn('[miles] could not hold a draft for conversation', conversationId)
    return { held: true }
  }

  const c = conv?.contact as { name?: string; phone?: string; email?: string } | null
  const who = c?.name?.trim() || c?.phone?.trim() || c?.email?.trim() || 'a customer'
  const sent = await notifyOwner(db, draft, { who, agentName: nameOf(agent) })

  if (!sent.notified) {
    console.error('[miles] held a draft but could not tell the owner:', sent.error)
    return { held: true, draftId: draft.id, notifyError: sent.error }
  }
  return { held: true, draftId: draft.id }
}

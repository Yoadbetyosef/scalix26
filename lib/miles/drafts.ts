import type { SupabaseClient } from '@supabase/supabase-js'
import type { Commitment } from './autonomy'

// THE HELD DRAFT — a reply Miles wrote and will not send without a person.
//
// The lifecycle is payment_requests': something the AI produced, waiting on a decision, terminal once
// decided. What it does NOT copy is 'expired'. A draft waits indefinitely — no timeout, no auto-send,
// no holding message — so there is no clock that can decide on the owner's behalf.
//
// These are the writes. The surfaces that let a person act on them come next: the inbox groups, then
// the notification with the same three actions. Until one of those exists NOTHING CALLS `hold()` —
// this stage builds the state, not the interception. A draft nobody can see is worse than no draft.

export type DraftStatus = 'pending' | 'sent' | 'handled' | 'replaced'

export interface HeldDraft {
  id: string
  tenant_id: string
  ai_employee_id: string | null
  conversation_id: string | null
  contact_id: string | null
  channel: string | null
  inbound_message_id: string | null
  inbound_excerpt: string | null
  body: string
  sent_body: string | null
  reasons: Commitment[]
  status: DraftStatus
  created_by: string
  created_at: string
  decided_at: string | null
  decided_by: string | null
  sent_message_id: string | null
}

export interface HoldInput {
  tenantId: string
  agentId: string
  conversationId: string
  contactId?: string | null
  channel: string
  inboundMessageId?: string | null
  inboundExcerpt?: string | null
  body: string
  reasons: Commitment[]
}

const COLS =
  'id, tenant_id, ai_employee_id, conversation_id, contact_id, channel, inbound_message_id, ' +
  'inbound_excerpt, body, sent_body, reasons, status, created_by, created_at, decided_at, ' +
  'decided_by, sent_message_id'

/**
 * Hold a draft, superseding whatever was already waiting on this conversation.
 *
 * A second inbound message means the earlier draft answers a stale question, and approving it would
 * put the owner's name against the wrong message. The old row is marked 'replaced' rather than
 * updated, so a draft that was held and never sent stays in the record — and so the partial unique
 * index (one pending per conversation) is satisfied by a state change rather than a delete.
 *
 * Two inbound messages arriving at once can both pass the update and race the insert. The partial
 * unique index settles it: the loser's insert is rejected, this returns null, and the failure is
 * logged. One draft held is the right outcome of that race; two pending on one thread is not.
 */
export async function hold(db: SupabaseClient, input: HoldInput): Promise<HeldDraft | null> {
  const now = new Date().toISOString()

  await db
    .from('held_drafts')
    .update({ status: 'replaced', decided_at: now, decided_by: 'superseded' })
    .eq('conversation_id', input.conversationId)
    .eq('status', 'pending')

  const { data, error } = await db
    .from('held_drafts')
    .insert({
      tenant_id: input.tenantId,
      ai_employee_id: input.agentId,
      conversation_id: input.conversationId,
      contact_id: input.contactId ?? null,
      channel: input.channel,
      inbound_message_id: input.inboundMessageId ?? null,
      // The customer's words travel with the draft: the notification shows what is being answered,
      // and a reply with no question above it is not reviewable.
      inbound_excerpt: input.inboundExcerpt?.slice(0, 500) ?? null,
      body: input.body,
      reasons: input.reasons,
      status: 'pending',
      created_by: 'ai',
    })
    .select(COLS)
    .single()

  if (error) {
    console.error('[miles/drafts] hold failed:', error.message)
    return null
  }
  return data as unknown as HeldDraft
}

/** Everything still waiting on this tenant, oldest first — the order a queue is worked. */
export async function pending(db: SupabaseClient, tenantId: string): Promise<HeldDraft[]> {
  const { data } = await db
    .from('held_drafts')
    .select(COLS)
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  return (data ?? []) as unknown as HeldDraft[]
}

export async function byId(db: SupabaseClient, tenantId: string, id: string): Promise<HeldDraft | null> {
  const { data } = await db
    .from('held_drafts').select(COLS).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  return (data as unknown as HeldDraft) ?? null
}

/**
 * The owner sent it — as drafted, or edited.
 *
 * Records what ACTUALLY went out. A row saying "sent" without the words that were sent in the owner's
 * name is the thing that would destroy trust in this feature, so `sent_body` is written whenever it
 * differs from the draft and the message id is linked once the send succeeds.
 *
 * Guarded on `status = 'pending'`: two taps on the same notification, or a link opened twice, must
 * send once. The update returns no row the second time.
 */
export async function markSent(
  db: SupabaseClient,
  tenantId: string,
  id: string,
  opts: { decidedBy: string; sentBody?: string | null; messageId?: string | null },
): Promise<HeldDraft | null> {
  const { data } = await db
    .from('held_drafts')
    .update({
      status: 'sent',
      sent_body: opts.sentBody ?? null,
      sent_message_id: opts.messageId ?? null,
      decided_at: new Date().toISOString(),
      decided_by: opts.decidedBy,
    })
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .eq('status', 'pending')
    .select(COLS)
    .maybeSingle()
  return (data as unknown as HeldDraft) ?? null
}

/**
 * "I'll handle it" — the owner takes the thread and Miles stops replying on it.
 *
 * Two writes, and the second is the one that matters: `conversations.human_takeover` is the existing
 * mechanism every inbound path already honours (runAIPipeline returns `skipped`, the email webhook
 * stores and stops). Without it, declining a draft would only decline THIS draft and the next message
 * would produce another one — which is exactly how every rejection becomes an edit.
 */
export async function markHandled(
  db: SupabaseClient,
  tenantId: string,
  id: string,
  decidedBy: string,
): Promise<HeldDraft | null> {
  const { data } = await db
    .from('held_drafts')
    .update({ status: 'handled', decided_at: new Date().toISOString(), decided_by: decidedBy })
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .eq('status', 'pending')
    .select(COLS)
    .maybeSingle()

  const draft = (data as unknown as HeldDraft) ?? null
  if (draft?.conversation_id) {
    await db
      .from('conversations')
      .update({ human_takeover: true, updated_at: new Date().toISOString() })
      .eq('id', draft.conversation_id)
  }
  return draft
}

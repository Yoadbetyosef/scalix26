import type { SupabaseClient } from '@supabase/supabase-js'
import { hashToken, looksLikeToken } from '@/lib/orders/approval-token'
import { deliverToConversation } from '@/lib/messaging/send'
import { byId, markSent, markHandled, unclaim, type HeldDraft } from './drafts'

// DECIDING A DRAFT — one implementation, two doors.
//
// The owner decides from inside the app (/api/miles/drafts/[id], with a session) or from the link in
// the SMS (/api/m/[token], with no session at all). Those are two different ways of proving who you
// are and exactly the same decision afterwards, so the rule that matters — claim first, deliver
// second, never send twice — lives here rather than twice.

export type DecisionAction = 'send' | 'handle'

export type Decision =
  | { ok: true; status: 'sent' | 'handled'; edited: boolean }
  | { ok: false; code: 'not_found' | 'already' | 'no_conversation' | 'empty' | 'delivery'; message: string }

/**
 * Find a draft by the raw token from a link.
 *
 * Only the SHA-256 hash is stored, so this hashes and looks up; the raw value never touches the
 * database and must never be logged. `looksLikeToken` is a cheap shape check before any query.
 */
export async function byToken(db: SupabaseClient, raw: string): Promise<HeldDraft | null> {
  if (!raw || !looksLikeToken(raw)) return null
  const { data } = await db
    .from('held_drafts')
    .select(
      'id, tenant_id, ai_employee_id, conversation_id, contact_id, channel, inbound_message_id, ' +
      'inbound_excerpt, body, sent_body, reasons, status, created_by, created_at, decided_at, ' +
      'decided_by, sent_message_id',
    )
    .eq('decide_token_hash', hashToken(raw))
    .maybeSingle()
  return (data as unknown as HeldDraft) ?? null
}

/**
 * Apply a decision to a draft that is still pending.
 *
 * ── WHY THE CLAIM COMES FIRST ─────────────────────────────────────────────────────────────────────
 *
 * A link in an SMS gets opened twice: the owner taps it, the page is slow, they tap again; or a
 * preview fetcher opens it before they do. `markSent` is guarded on status='pending', so the first
 * call takes the row and every later one gets nothing back — that guard IS the idempotence, and it is
 * the same guard whichever door the decision came through.
 *
 * The cost is a delivery that fails after the claim, which would leave a row saying sent for a
 * message the customer never received. That is reverted here and reported, because "pending" is the
 * truthful state for a reply that did not go out.
 */
export async function applyDecision(
  db: SupabaseClient,
  tenantId: string,
  draftId: string,
  action: DecisionAction,
  opts: { decidedBy: string; body?: string | null },
): Promise<Decision> {
  const draft = await byId(db, tenantId, draftId)
  if (!draft) return { ok: false, code: 'not_found', message: 'That draft is no longer here.' }
  if (draft.status !== 'pending') {
    return { ok: false, code: 'already', message: 'This one has already been decided.' }
  }

  if (action === 'handle') {
    const out = await markHandled(db, tenantId, draftId, opts.decidedBy)
    if (!out) return { ok: false, code: 'already', message: 'This one has already been decided.' }
    return { ok: true, status: 'handled', edited: false }
  }

  const edited = typeof opts.body === 'string' ? opts.body.trim() : ''
  const text = edited || draft.body
  if (!text.trim()) return { ok: false, code: 'empty', message: 'There is nothing to send.' }
  if (!draft.conversation_id) {
    return { ok: false, code: 'no_conversation', message: 'This draft has no conversation to reply to.' }
  }

  const wasEdited = !!edited && edited !== draft.body
  const claimed = await markSent(db, tenantId, draftId, {
    decidedBy: opts.decidedBy,
    sentBody: wasEdited ? edited : null,
  })
  if (!claimed) return { ok: false, code: 'already', message: 'This one has already been decided.' }

  const delivery = await deliverToConversation(tenantId, draft.conversation_id, text)
  if (!delivery.delivered) {
    await unclaim(db, tenantId, draftId)
    return {
      ok: false,
      code: 'delivery',
      message: delivery.error || 'That did not send. It is still waiting for you.',
    }
  }

  return { ok: true, status: 'sent', edited: wasEdited }
}

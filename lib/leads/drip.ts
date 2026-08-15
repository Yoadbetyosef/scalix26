import { normalizePhone } from '@/lib/contacts/store'
import type { SupabaseClient } from '@supabase/supabase-js'

// THE BRAKE ON THE FOLLOW-UP SEQUENCE.
//
// A drip campaign texts a lead at +2h, +2 days and +3 days — "just following up". It stopped for
// exactly three things: the lead being marked `booked`, the lead being marked `dismissed`, or the
// customer texting the literal word STOP.
//
// A customer who REPLIED and had a whole conversation with the AI stopped nothing. The lead sits at
// `contacted` forever — nothing moves it — so the sequence ran to completion behind a conversation
// that was already handled. Measured on the live table before this existed: 28 campaigns, 20 of them
// run to all three messages.
//
// Answering is the strongest possible signal that the follow-up is no longer wanted. This is that
// brake, and it is the only thing in this file.
//
// ── WHY NOT .eq('contact_phone', From) ──────────────────────────────────────────────────────────
//
// `contact_phone` is whatever string reached intakeLead. From Twilio that is E.164; from a web form
// it is whatever the form posted — `leads.phone` on the live table already holds '(917) 495-4300'
// and '9174954300' beside the +1-prefixed ones. An exact match would look fitted and never engage
// for those rows, which is worse than no brake: the queue reads healthy while the customer is
// texted three more times.
//
// So the comparison is normalizePhone's — the last ten digits, the rule this codebase already uses
// for "a number and its +1 form are the same person". PostgREST cannot express that as a filter, so
// the tenant's ACTIVE campaigns are read (indexed on tenant_id, contact_phone; a handful at most)
// and matched here. The STOP handler routes through this too, because it had the same blind spot.
//
// ── ALL OF THEM, NOT ONE ────────────────────────────────────────────────────────────────────────
//
// Every lead starts its own campaign and nothing dedupes them: one number on the live table has 21.
// Stopping the first match would leave the rest sending. See OUTSTANDING §21.

export interface StopResult {
  /** How many campaigns were actually stopped. Zero is the ordinary case — most people never reply. */
  stopped: number
  /** Ids, so a caller (and the probe) can say exactly which rows moved. */
  ids: string[]
}

interface Row { id: string; contact_phone: string | null }

/**
 * End every active follow-up sequence for this phone number, in this tenant.
 *
 * Best-effort by contract: it is called from inbound webhooks where the customer's reply matters far
 * more than the bookkeeping, so it never throws and never blocks the reply.
 *
 * Does NOT touch `leads.status`. A reply is not a booking and not a dismissal, and inventing a lead
 * state here would hide the thing the home screen still has to be fixed to say honestly.
 */
export async function stopDripsForPhone(
  db: SupabaseClient,
  tenantId: string,
  phone: string | null | undefined,
  reason: string,
): Promise<StopResult> {
  const key = normalizePhone(phone)
  if (!tenantId || !key) return { stopped: 0, ids: [] }

  try {
    const { data } = await db
      .from('drip_campaigns')
      .select('id, contact_phone')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')

    const ids = ((data ?? []) as Row[])
      .filter((r) => normalizePhone(r.contact_phone) === key)
      .map((r) => r.id)
    if (!ids.length) return { stopped: 0, ids: [] }

    const { error } = await db
      .from('drip_campaigns')
      .update({ status: 'stopped', updated_at: new Date().toISOString() })
      .in('id', ids)
      // Belt and braces: the ids came from a tenant-scoped read, and the write says so too.
      .eq('tenant_id', tenantId)
    if (error) {
      console.error('[drip] stop failed:', error.message)
      return { stopped: 0, ids: [] }
    }

    console.log(`[drip] stopped ${ids.length} campaign(s) — ${reason}`)
    return { stopped: ids.length, ids }
  } catch (err) {
    console.error('[drip] stop threw:', err instanceof Error ? err.message : err)
    return { stopped: 0, ids: [] }
  }
}

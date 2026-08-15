import { normalizePhone } from '@/lib/contacts/store'
import { stopDripsForPhone } from './drip'
import type { SupabaseClient } from '@supabase/supabase-js'

// BOOKED IS DERIVED, NOT CLAIMED.
//
// `leads.status = 'booked'` used to be reachable only by the owner pressing "Mark as Booked" on the
// dashboard. Nothing computed it, so nobody maintained it: on the live table, twelve leads and zero
// booked ones — beside a table of real confirmed appointments.
//
// It is the terminal state of the funnel and one of the three things that stops a follow-up
// sequence, so a state nobody sets is a sequence nobody stops. Now an appointment sets it. The
// button is gone: there is nothing left for a human to remember.
//
// ── WHICH LEAD ─────────────────────────────────────────────────────────────────────────────────
//
// The person's OPEN leads — new, contacted, called_back. Not the booked ones (already there), and
// pointedly not the dismissed ones: "not a customer" is a judgement somebody made, and a later
// booking should not silently overturn it. If they really did book, they have a new lead by now.
//
// Matched by contact_id when there is one, and otherwise by phone on the last ten digits — the same
// rule as the drip brake, for the same reason: `leads.phone` holds '(917) 495-4300' and '9174954300'
// beside the E.164 ones, so an exact match would look fitted and miss them.

/** The statuses a booking may move. Dismissed is deliberately absent — see above. */
export const OPEN_FOR_BOOKING = ['new', 'contacted', 'called_back'] as const

export interface BookedResult {
  /** How many leads moved to booked. Zero is ordinary — most bookings are from existing customers. */
  marked: number
  ids: string[]
}

interface Row { id: string; phone: string | null; contact_id: string | null }

/**
 * Mark this person's open leads booked, and stop the follow-ups that were chasing them.
 *
 * Best-effort by contract: it is called after an appointment has already been confirmed and written,
 * and no bookkeeping failure may unbook a customer. It never throws.
 */
export async function markLeadsBooked(
  db: SupabaseClient,
  tenantId: string,
  contactId: string | null,
  phone: string | null | undefined,
): Promise<BookedResult> {
  if (!tenantId || (!contactId && !normalizePhone(phone))) return { marked: 0, ids: [] }

  try {
    const { data } = await db
      .from('leads')
      .select('id, phone, contact_id')
      .eq('tenant_id', tenantId)
      .in('status', OPEN_FOR_BOOKING as unknown as string[])

    const key = normalizePhone(phone)
    const ids = ((data ?? []) as Row[])
      .filter((r) => (contactId && r.contact_id === contactId) || (!!key && normalizePhone(r.phone) === key))
      .map((r) => r.id)

    if (ids.length) {
      const { error } = await db
        .from('leads')
        .update({ status: 'booked' })
        .in('id', ids)
        .eq('tenant_id', tenantId)
      if (error) {
        console.error('[leads] mark booked failed:', error.message)
        return { marked: 0, ids: [] }
      }
      console.log(`[leads] ${ids.length} lead(s) booked by an appointment`)
    }

    // Booked is one of the drip's own stop conditions, so the cron would eventually notice. Eventually
    // is a day away — the customer has an appointment and should not be asked again in the meantime.
    await stopDripsForPhone(db, tenantId, phone, 'appointment booked')

    return { marked: ids.length, ids }
  } catch (err) {
    console.error('[leads] mark booked threw:', err instanceof Error ? err.message : err)
    return { marked: 0, ids: [] }
  }
}

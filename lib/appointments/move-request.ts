import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { nextFreeSlots, slotLabel, type OfferedSlot } from './next-slots'
import { deliverToConversation } from '@/lib/messaging/send'
import { sendSMS } from '@/lib/twilio/client'
import { normalizePhone } from '@/lib/contacts/store'

// ASKING A CUSTOMER TO MOVE.
//
// ── UNFINISHED, AND SAYING SO ───────────────────────────────────────────────────────────────────
//
// NOTHING CALLS THIS YET. It is the send half of "Ask Rudi to reschedule": compose, pick real slots,
// write the appointment_moves row, deliver. The three pieces that make it a feature are not built:
//
//   the route         POST /api/appointments/[id]/move-request
//   the confirmation  the agenda's third sheet option, showing composeMoveRequest()'s exact words
//   the reply matcher resolving "Thursday works" against `offered` BEFORE the keyword scan, and the
//                     clash case — re-check the slot, apologise, re-offer, leave the appointment put
//   the expiry sweep  marking an unanswered request expired so the agenda stops implying agreement
//
// It is committed rather than left in a working tree because unreferenced code on disk is code that
// gets lost or, worse, half-remembered and rewritten differently. The table it writes to exists and
// is empty: appointment_moves, migration add_appointment_moves.sql, applied.
//
// ── THE OWNER SEES THE WORDS BEFORE THEY GO ─────────────────────────────────────────────────────
//
// composeMoveRequest() is pure and is called TWICE: once to show the owner exactly what will be sent,
// and once by the send path. Not "a preview that is usually the same" — the same function, so the
// message in the confirmation is the message in the customer's phone. Anything else is a screen
// making a promise the sender can quietly break.
//
// It is also what lands in appointment_moves.message_sent, so the owner can read it again next week.
//
// ── HOW LONG IT WAITS ───────────────────────────────────────────────────────────────────────────
//
// Two days, or until the appointment itself, whichever is sooner. Waiting past the appointment is
// absurd — the slot has happened — and a request that outlives its own subject is the limbo this was
// built to avoid.

/** Two days, in ms. Long enough for somebody to reply after a working day; short enough to matter. */
const DEFAULT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000

export interface MoveComposeInput {
  businessName: string
  customerName: string | null
  /** The appointment as it stands — what we are asking to move away from. */
  currentLabel: string
  offered: OfferedSlot[]
}

/**
 * The exact message. One place, shown and sent.
 *
 * Deliberately plain: it says who it is from, what is being asked, and what the options are, then
 * stops. No apology theatre, no "we sincerely regret" — an owner moving an appointment is ordinary,
 * and a message that over-apologises reads as something having gone badly wrong.
 */
export function composeMoveRequest(input: MoveComposeInput): string {
  const hi = input.customerName?.trim() ? `Hi ${input.customerName.trim()}, ` : 'Hi, '
  const options = input.offered.map((s, i) => `${i + 1}. ${s.label}`).join('\n')
  return (
    `${hi}it's ${input.businessName}. I need to move your appointment on ${input.currentLabel}. ` +
    `Would any of these work?\n\n${options}\n\n` +
    `Just reply with the number and I'll book it. If none of them suit, tell me what does.`
  )
}

export type MoveRequestResult =
  | { ok: true; moveId: string; message: string; offered: OfferedSlot[]; channel: 'conversation' | 'sms' }
  | { ok: false; error: string; reason?: 'no_slots' | 'already_pending' | 'no_contact' | 'not_found' }

/**
 * Everything the button needs, minus the sending — so the confirmation can show the real message and
 * the real slots without a dry-run flag threaded through the send path.
 */
export async function prepareMoveRequest(appointmentId: string): Promise<MoveRequestResult> {
  const c = await requireActiveBusinessContext()
  if (!c) return { ok: false, error: 'Not signed in', reason: 'not_found' }
  const db = createAdminClient()

  const { data: appt } = await db.from('appointments')
    .select('id, tenant_id, slot_date, slot_time, customer_name, customer_phone, contact_id, status')
    .eq('id', appointmentId).eq('tenant_id', c.tenantId).maybeSingle()
  if (!appt) return { ok: false, error: 'That appointment no longer exists.', reason: 'not_found' }
  if (appt.status === 'cancelled') return { ok: false, error: 'That appointment is cancelled — there is nothing to move.', reason: 'not_found' }
  if (!appt.customer_phone) {
    return { ok: false, error: 'There is no phone number on this appointment, so there is nobody to text.', reason: 'no_contact' }
  }

  // ONE LIVE OFFER AT A TIME. The database enforces it too; this is so the owner is told why rather
  // than shown a constraint violation.
  const { data: existing } = await db.from('appointment_moves')
    .select('id').eq('appointment_id', appointmentId).eq('status', 'pending').maybeSingle()
  if (existing) {
    return { ok: false, error: 'You have already asked them to move this one, and they have not replied yet.', reason: 'already_pending' }
  }

  const offered = await nextFreeSlots(c.tenantId, { count: 3, excludeAppointmentId: appointmentId })
  if (offered.length === 0) {
    // Nothing to offer is not a failure to hide. A message promising options that do not exist is
    // worse than telling the owner their diary is full.
    return { ok: false, error: 'You have no free slots in the next two weeks, so there is nothing to offer them.', reason: 'no_slots' }
  }

  const { data: tenant } = await db.from('tenants').select('business_name').eq('id', c.tenantId).maybeSingle()
  const message = composeMoveRequest({
    businessName: (tenant?.business_name as string) || 'us',
    customerName: appt.customer_name as string | null,
    currentLabel: slotLabel(appt.slot_date as string, String(appt.slot_time).slice(0, 5)),
    offered,
  })

  return { ok: true, moveId: '', message, offered, channel: 'sms' }
}

/**
 * Send it, and record what was sent.
 *
 * The row is written FIRST. If the send then fails the row is removed, because a pending move nobody
 * received would block the next attempt on the unique index and sit in the agenda claiming a customer
 * had been asked something they were never asked.
 */
export async function sendMoveRequest(appointmentId: string): Promise<MoveRequestResult> {
  const prepared = await prepareMoveRequest(appointmentId)
  if (!prepared.ok) return prepared

  const c = await requireActiveBusinessContext()
  if (!c) return { ok: false, error: 'Not signed in', reason: 'not_found' }
  const db = createAdminClient()

  const { data: appt } = await db.from('appointments')
    .select('id, customer_phone, contact_id, slot_date')
    .eq('id', appointmentId).eq('tenant_id', c.tenantId).maybeSingle()
  if (!appt) return { ok: false, error: 'That appointment no longer exists.', reason: 'not_found' }

  // The thread the reply will arrive in, when there is one. Matching on the normalised phone is the
  // repo-wide identity rule — an exact match mints duplicates.
  const phoneKey = normalizePhone(appt.customer_phone as string)
  const { data: convo } = await db.from('conversations')
    .select('id').eq('tenant_id', c.tenantId).eq('contact_id', appt.contact_id ?? '')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle()

  // Two days, or the appointment itself, whichever comes first.
  const apptAt = new Date(`${appt.slot_date}T00:00:00Z`).getTime()
  const expiresAt = new Date(Math.min(Date.now() + DEFAULT_WINDOW_MS, apptAt)).toISOString()

  const { data: move, error: insErr } = await db.from('appointment_moves').insert({
    tenant_id: c.tenantId,
    appointment_id: appointmentId,
    conversation_id: convo?.id ?? null,
    offered: prepared.offered,
    message_sent: prepared.message,
    expires_at: expiresAt,
    created_by: c.actorUserId ?? null,
  }).select('id').single()

  if (insErr || !move) {
    // 23505 is the one-pending-per-appointment index, which prepare already checked — so this is a
    // race with another tab rather than a mistake.
    if (insErr?.code === '23505') return { ok: false, error: 'You have already asked them to move this one.', reason: 'already_pending' }
    return { ok: false, error: insErr?.message || 'That could not be saved.' }
  }

  let delivered = false
  let channel: 'conversation' | 'sms' = 'sms'
  if (convo?.id) {
    const r = await deliverToConversation(c.tenantId, convo.id, prepared.message)
    delivered = r.delivered
    channel = 'conversation'
  }
  if (!delivered) {
    // No thread, or the thread's channel refused. Fall back to plain SMS on the tenant's number.
    const { data: ch } = await db.from('channels').select('twilio_number')
      .eq('tenant_id', c.tenantId).eq('type', 'sms').not('twilio_number', 'is', null).limit(1).maybeSingle()
    const from = (ch?.twilio_number as string) || process.env.TWILIO_PHONE_NUMBER
    if (from && phoneKey) {
      try {
        await sendSMS(appt.customer_phone as string, prepared.message, from)
        delivered = true
        channel = 'sms'
      } catch { /* falls through to the rollback below */ }
    }
  }

  if (!delivered) {
    // Nothing reached them. Remove the row rather than leave a pending move that blocks the next
    // attempt and tells the agenda a customer is deciding something they never saw.
    await db.from('appointment_moves').delete().eq('id', move.id)
    return { ok: false, error: 'That message could not be sent, so nothing was recorded. Check the number and try again.' }
  }

  return { ok: true, moveId: move.id as string, message: prepared.message, offered: prepared.offered, channel }
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { createAppointment, OWNER_POLICY, MEETING_KINDS } from '@/lib/appointments/create'
import { notifyBooking } from '@/lib/appointments/notify'
import { v2Allowed } from '@/lib/v2/access'

// THE OWNER'S BOOKING ENDPOINT — beside /book, not inside it.
//
// /book is in PUBLIC_ROUTES: it is deliberately exempt from the auth middleware, and the token in its
// body IS its security. Teaching it to accept a session as well would put two credential paths in one
// handler that nothing upstream protects. This repo already made that call once — /api/leads/inbound
// accepted a tenant_id in the body and now answers 410, pointing at the tokenised route.
//
// The insert is shared (lib/appointments/create.ts). What differs is the POLICY:
//
//   the slot grid   NOT enforced. `appointment_slots` is what the business offers STRANGERS. On the
//                   live tenant it holds Sunday 9, Monday 9 and Tuesday 9–4 and nothing Wednesday
//                   through Saturday; 28 of 33 tenants have no grid at all. Enforcing it would make
//                   this button refuse most days, or every day — which is the whole complaint.
//   the lead buffer NOT enforced. An owner booking something for twenty minutes' time is ordinary.
//   the past        STILL refused, for both. Logging history is a separate feature.
//   double-booking  STILL refused, for both. Not a policy — a fact about time.
//   notifications   OFF unless asked for. An owner is often RECORDING something already agreed on
//                   the phone, and an unexpected "✅ Confirmed!" to that customer cannot be taken
//                   back. The owner is never told about a row they just typed.
const schema = z.object({
  date: z.string().min(1).max(40),
  time: z.string().min(1).max(20),
  customer_name: z.string().max(300).nullable().optional(),
  // NOT NULL on the column, so a walk-in with no number cannot be stored — OUTSTANDING §29.
  customer_phone: z.string().min(3).max(50),
  customer_email: z.union([z.string().email().max(320), z.literal('')]).nullable().optional(),
  service_type: z.string().max(300).nullable().optional(),
  meeting_kind: z.enum(['on_site', 'at_business', 'zoom', 'google_meet', 'phone']).optional(),
  address: z.string().max(1000).nullable().optional(),
  join_url: z.string().max(500).nullable().optional(),
  duration_minutes: z.number().int().min(5).max(480).nullable().optional(),
  /** The one send this route will make, and only when it is explicitly asked for. */
  notify_customer: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // /v2-only today — the agenda's New sheet is the sole caller and v1 has no owner-side create.
  // DELETE THIS LINE when v1 gains one; it is a rollout gate, not a permission.
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!v2Allowed(ctx.tenantId, user?.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  }
  const d = parsed.data
  const joinRaw = (d.join_url ?? '').trim()

  const result = await createAppointment({
    tenantId: ctx.tenantId,
    date: d.date,
    time: d.time,
    name: (d.customer_name ?? '').trim() || null,
    phone: d.customer_phone.trim(),
    email: (d.customer_email ?? '').trim() || null,
    service: (d.service_type ?? '').trim() || null,
    meetingKind: d.meeting_kind && MEETING_KINDS.includes(d.meeting_kind) ? d.meeting_kind : 'on_site',
    address: (d.address ?? '').trim() || null,
    // Same rule as the AI door: a link or nothing, never a fragment stored as one.
    joinUrl: /^https?:\/\/\S+$/i.test(joinRaw) ? joinRaw : null,
    durationMinutes: d.duration_minutes ?? null,
  }, OWNER_POLICY)

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  }

  await notifyBooking({
    tenantId: ctx.tenantId, dateIso: result.dateIso, timeDb: result.timeDb,
    name: (d.customer_name ?? '').trim() || null,
    phone: d.customer_phone.trim(),
    email: (d.customer_email ?? '').trim() || null,
    service: (d.service_type ?? '').trim() || null,
    channel: 'owner',
    customer: d.notify_customer === true,
    // Never. They are the one who created it.
    owner: false,
  })

  return NextResponse.json({ ok: true, appointment_id: result.appointmentId })
}

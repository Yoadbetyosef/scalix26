import { NextRequest, NextResponse } from 'next/server'
import { sendReviewForAppointment, cronAuthorized } from '@/lib/reviews'

// POST { appointment_id } — send a Google review request SMS. Gated by the cron
// bearer (it sends an SMS, so it must not be openly triggerable).
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { appointment_id } = (await req.json().catch(() => ({}))) as { appointment_id?: string }
  if (!appointment_id) return NextResponse.json({ error: 'appointment_id required' }, { status: 400 })

  const result = await sendReviewForAppointment(appointment_id)
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendReviewForAppointment } from '@/lib/reviews'

// Manual "Send Review Now" from the dashboard. Auth-gated (not the cron bearer):
// RLS confirms the appointment belongs to the signed-in user's tenant.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // RLS ("Tenant appointments access") only returns the row if it's the user's.
  const { data: appt } = await supabase.from('appointments').select('id').eq('id', id).maybeSingle()
  if (!appt) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const result = await sendReviewForAppointment(id, { force: true })
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}

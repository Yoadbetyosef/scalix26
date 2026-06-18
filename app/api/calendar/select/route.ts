import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { setCalendarSelection, getCalendarAccess, resolveOwnerTenantId } from '@/lib/calendar/store'
import { listCalendars } from '@/lib/calendar/google'

// POST { calendarId } → set which calendar new bookings are written to.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { calendarId?: string }
  const calendarId = typeof body.calendarId === 'string' && body.calendarId.trim() ? body.calendarId.trim() : ''
  if (!calendarId) return NextResponse.json({ error: 'calendarId required' }, { status: 400 })

  const tenantId = await resolveOwnerTenantId(user.id)
  if (!tenantId) return NextResponse.json({ error: 'no tenant' }, { status: 404 })

  // Look up the human-readable name (best-effort).
  let summary: string | null = null
  try {
    const access = await getCalendarAccess(tenantId)
    if (access) summary = (await listCalendars(access.accessToken)).find((c) => c.id === calendarId)?.summary || null
  } catch { /* name is cosmetic */ }

  await setCalendarSelection(tenantId, calendarId, summary)
  return NextResponse.json({ success: true })
}

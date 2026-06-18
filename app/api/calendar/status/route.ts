import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCalendarStatus, getCalendarAccess, resolveOwnerTenantId } from '@/lib/calendar/store'
import { listCalendars } from '@/lib/calendar/google'

// GET → { connected, email, calendarId, calendars: [{id, summary, primary}] }
// Used by the Connect Google Calendar UI to render state + the calendar picker.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await resolveOwnerTenantId(user.id)
  if (!tenantId) return NextResponse.json({ connected: false, calendars: [] })

  const status = await getCalendarStatus(tenantId)
  if (!status.connected) return NextResponse.json({ connected: false, calendars: [] })

  // List calendars for the picker (best-effort — never break the status read).
  let calendars: { id: string; summary: string; primary: boolean }[] = []
  try {
    const access = await getCalendarAccess(tenantId)
    if (access) calendars = await listCalendars(access.accessToken)
  } catch { /* leave empty */ }

  return NextResponse.json({ connected: true, email: status.email, calendarId: status.calendarId, calendars })
}

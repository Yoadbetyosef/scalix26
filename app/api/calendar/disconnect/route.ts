import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { disconnectCalendar, resolveOwnerTenantId } from '@/lib/calendar/store'

// POST → remove the tenant's Google Calendar connection. Bookings keep working
// (the appointments table stays the system of record); new events just stop syncing.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await resolveOwnerTenantId(user.id)
  if (!tenantId) return NextResponse.json({ error: 'no tenant' }, { status: 404 })

  await disconnectCalendar(tenantId)
  return NextResponse.json({ success: true })
}

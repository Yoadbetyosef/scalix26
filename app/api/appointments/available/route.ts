import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { parseDate, dayOfWeek, formatTime12 } from '@/lib/appointments'

// GET ?lead_token=…&date=… → { date, slots: ["9:00 AM", …] }
// Tenant is resolved from the lead token (not a spoofable tenant_id).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const leadToken = sp.get('lead_token') || ''
  const dateInput = sp.get('date') || ''
  if (!leadToken || !dateInput) {
    return NextResponse.json({ slots: [], error: 'lead_token and date are required' }, { status: 400 })
  }

  const dateIso = parseDate(dateInput)
  if (!dateIso) return NextResponse.json({ slots: [], error: 'could not understand the date' })

  const supabase = await createServiceClient()
  const { data: tenant } = await supabase.from('tenants').select('id').eq('lead_intake_token', leadToken).maybeSingle()
  if (!tenant) return NextResponse.json({ slots: [], error: 'invalid token' }, { status: 404 })

  const [{ data: slots }, { data: booked }] = await Promise.all([
    supabase.from('appointment_slots').select('slot_time')
      .eq('tenant_id', tenant.id).eq('day_of_week', dayOfWeek(dateIso)).eq('is_active', true).order('slot_time'),
    supabase.from('appointments').select('slot_time')
      .eq('tenant_id', tenant.id).eq('slot_date', dateIso).neq('status', 'cancelled'),
  ])

  const taken = new Set((booked || []).map((b) => String(b.slot_time)))
  const available = (slots || [])
    .map((s) => String(s.slot_time))
    .filter((t) => !taken.has(t))
    .map((t) => formatTime12(t))

  return NextResponse.json({ date: dateIso, slots: available })
}

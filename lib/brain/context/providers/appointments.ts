import type { ContextProvider } from '../types'

// Appointments. Customer-scoped: only the identified customer's own upcoming appointments. Actual booking
// still runs through the existing booking tools; this just makes the AI aware of what's on the books.
export const appointmentsProvider: ContextProvider = {
  key: 'appointments',
  label: 'Appointments',
  keywords: ['appointment', 'appointments', 'book', 'booking', 'schedule', 'scheduled', 'reschedule', 'cancel', 'slot', 'my visit', 'when can i', 'come in'],
  async fetch(req, db) {
    if (!req.contactId) {
      return { available: false, text: 'No appointment is identified for this customer yet. New appointments can be booked; do not claim an existing appointment exists.' }
    }
    const { data } = await db
      .from('appointments')
      .select('slot_date, slot_time, service_type, status')
      .eq('tenant_id', req.tenantId)
      .eq('contact_id', req.contactId)
      .eq('status', 'confirmed')
      .order('slot_date', { ascending: true })
      .limit(5)
    if (!data || data.length === 0) return { available: false, text: 'This customer has no upcoming confirmed appointments on file.' }
    return { available: true, text: data.map((a) => `- ${a.slot_date} ${a.slot_time}${a.service_type ? ` — ${a.service_type}` : ''} (${a.status})`).join('\n') }
  },
}

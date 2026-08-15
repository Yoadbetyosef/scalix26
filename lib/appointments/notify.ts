import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/twilio/client'
import { sendEmail, emailTemplates } from '@/lib/email/send'
import { assertPartnerActive } from '@/lib/billing/gate'
import { formatTime12 } from '@/lib/appointments'

// WHO GETS TOLD ABOUT A NEW APPOINTMENT.
//
// Separate from createAppointment because the two paths want DIFFERENT answers, and the wrong answer
// here is the one that cannot be taken back.
//
// The AI books for a stranger: the customer gets a confirmation, and the owner is told a thing
// happened while they were not looking. Both are right.
//
// An owner typing into a form is often RECORDING something already agreed on the phone. Texting that
// customer "✅ Confirmed!" out of nowhere is not recoverable, and telling the owner by SMS about a
// row they just typed is noise. So the owner path defaults to sending nothing and offers the customer
// text as an explicit choice.
//
// Best-effort throughout: the appointment is already written and no send failure may unwrite it.

function friendlyDate(dateIso: string): string {
  return new Date(`${dateIso}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  })
}

export interface NotifyInput {
  tenantId: string
  dateIso: string
  timeDb: string
  name: string | null
  phone: string
  email: string | null
  service: string | null
  channel: string
  /** Text the customer that it is confirmed. */
  customer: boolean
  /** Tell the owner it happened. False when the owner is the one who did it. */
  owner: boolean
}

export async function notifyBooking(input: NotifyInput): Promise<void> {
  if (!input.customer && !input.owner) return
  const supabase = await createServiceClient()

  const { data: tenant } = await supabase
    .from('tenants').select('business_name, phone, email').eq('id', input.tenantId).maybeSingle()
  if (!tenant) return

  // WL prepaid billing gate — the appointment is ALWAYS persisted; only the billable sends are
  // withheld when the owning partner is paused or depleted. Resolved once.
  const allowed = (await assertPartnerActive({ tenantId: input.tenantId })).ok
  if (!allowed) return

  const { data: ch } = await supabase.from('channels').select('twilio_number')
    .eq('tenant_id', input.tenantId).eq('type', 'sms').not('twilio_number', 'is', null).limit(1).maybeSingle()
  const fromNumber = ch?.twilio_number || undefined
  const business = tenant.business_name || 'us'
  const when = `${friendlyDate(input.dateIso)} at ${formatTime12(input.timeDb)}`

  if (input.customer) {
    try {
      await sendSMS(input.phone, `✅ Confirmed! Your appointment is on ${when}. See you then! - ${business}`, fromNumber)
    } catch (err) {
      console.error('[appointments] customer SMS failed:', err instanceof Error ? err.message : err)
    }
  }

  if (!input.owner) return

  // Owner contact resolved per-tenant (never hardcoded): tenant.phone, falling back to the agent's
  // forward number. Owner email = the tenant's account email.
  let ownerPhone = tenant.phone
  if (!ownerPhone) {
    const { data: ag } = await supabase.from('ai_employees').select('forward_to_phone')
      .eq('tenant_id', input.tenantId).not('forward_to_phone', 'is', null).limit(1).maybeSingle()
    ownerPhone = ag?.forward_to_phone || null
  }
  const ownerSms = `📅 New appointment: ${input.name || 'Customer'} on ${when} for ${input.service || 'service'}. Phone: ${input.phone}`
  if (ownerPhone) {
    try { await sendSMS(ownerPhone, ownerSms, fromNumber) }
    catch (err) { console.error('[appointments] owner SMS failed:', err instanceof Error ? err.message : err) }
  }
  if (tenant.email) {
    try {
      const tmpl = emailTemplates.appointmentBooked({
        business, customer: input.name || 'Customer', when, phone: input.phone,
        service: input.service || 'Service', email: input.email, channel: input.channel,
      })
      await sendEmail(tenant.email, tmpl.subject, tmpl.html)
    } catch (err) {
      console.error('[appointments] owner email failed:', err instanceof Error ? err.message : err)
    }
  }
}

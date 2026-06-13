import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/twilio/client'

// Shared so both /api/reviews/send and the /api/reviews/process cron use the
// exact same logic (the cron calls this directly — no internal HTTP hop).
export async function sendReviewForAppointment(
  appointmentId: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createServiceClient()

  const { data: appt } = await supabase
    .from('appointments')
    .select('id, tenant_id, customer_name, customer_phone, review_sent_at')
    .eq('id', appointmentId)
    .maybeSingle()
  if (!appt) return { ok: false, error: 'appointment not found' }
  if (appt.review_sent_at && !opts.force) return { ok: false, error: 'already sent' }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('business_name, google_review_url, review_automation_enabled')
    .eq('id', appt.tenant_id)
    .maybeSingle()
  if (!tenant?.google_review_url) return { ok: false, error: 'no google_review_url' }

  const { data: ch } = await supabase
    .from('channels').select('twilio_number')
    .eq('tenant_id', appt.tenant_id).eq('type', 'sms').not('twilio_number', 'is', null).limit(1).maybeSingle()

  const name = appt.customer_name || 'there'
  const business = tenant.business_name || 'us'
  const message = `Hi ${name}! Hope your service went well 😊 Would you mind leaving us a quick Google review? It means the world to us! ${tenant.google_review_url} - ${business}`

  try {
    await sendSMS(appt.customer_phone, message, ch?.twilio_number || undefined)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'sms failed' }
  }

  await supabase.from('appointments').update({ review_sent_at: new Date().toISOString() }).eq('id', appointmentId)
  return { ok: true }
}

// Cron auth shared by the review endpoints. Set CRON_SECRET in Vercel to the
// same value used in cron-job.org's Authorization header.
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET || 'scalix26-drip-2026'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

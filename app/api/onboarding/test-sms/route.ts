import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/twilio/client'

// Sends a test SMS to the owner's own phone, then marks the 'tested' checklist
// item done. Part of the post-onboarding success checklist.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { data: tenant } = await service
    .from('tenants')
    .select('id, phone, business_name, onboarding_checklist')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!tenant.phone) {
    return NextResponse.json({ error: 'Add your business phone number in Settings first.' }, { status: 400 })
  }

  // Send from the tenant's AI number if available
  const { data: ch } = await service
    .from('channels')
    .select('twilio_number')
    .eq('tenant_id', tenant.id)
    .not('twilio_number', 'is', null)
    .limit(1)
    .maybeSingle()

  try {
    await sendSMS(
      tenant.phone,
      `✅ Test message from your AI assistant at ${tenant.business_name} — everything is working! Reply to this anytime to chat with your AI.`,
      ch?.twilio_number || undefined,
    )
  } catch (err) {
    console.error('[onboarding/test-sms] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to send test message' }, { status: 502 })
  }

  const checklist = { ...(tenant.onboarding_checklist || {}), tested: true }
  await service.from('tenants').update({ onboarding_checklist: checklist }).eq('id', tenant.id)

  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// One-time setup: links the platform Twilio number to the logged-in user's tenant
// and ensures they have an active AI employee for testing.
// Visit https://app.scalix26.com/api/admin/seed-channels while logged in.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const service = await createServiceClient()

  const { data: tenant } = await service
    .from('tenants')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!tenant) return NextResponse.json({ error: 'No tenant found' }, { status: 404 })

  const platformNumber = process.env.TWILIO_PHONE_NUMBER!

  // Create SMS + Voice + Meta channels if they don't exist
  const { data: existing } = await service
    .from('channels')
    .select('id, type')
    .eq('tenant_id', tenant.id)
    .in('type', ['sms', 'voice', 'instagram', 'facebook'])

  const existingTypes = (existing || []).map((c: { type: string }) => c.type)

  const twilioChannels = (['sms', 'voice'] as const)
    .filter(t => !existingTypes.includes(t))
    .map(type => ({
      tenant_id: tenant.id,
      type,
      twilio_number: platformNumber,
      status: 'connected',
      credentials: {},
    }))

  const metaChannels = [
    { type: 'instagram', meta_page_id: process.env.META_INSTAGRAM_ID },
    { type: 'facebook', meta_page_id: process.env.META_PAGE_ID },
  ]
    .filter(c => c.meta_page_id && !existingTypes.includes(c.type))
    .map(c => ({
      tenant_id: tenant.id,
      type: c.type,
      meta_page_id: c.meta_page_id,
      status: 'connected',
      credentials: {},
    }))

  const toInsert = [...twilioChannels, ...metaChannels]

  if (toInsert.length > 0) {
    await service.from('channels').insert(toInsert)
  }

  // Ensure there's an active AI employee
  const { data: employees } = await service
    .from('ai_employees')
    .select('id, status')
    .eq('tenant_id', tenant.id)

  if (!employees || employees.length === 0) {
    await service.from('ai_employees').insert({
      tenant_id: tenant.id,
      name: 'Alex',
      greeting: 'Hi! Thank you for reaching out. How can I help you today?',
      personality: 'friendly',
      personality_score: 75,
      status: 'active',
    })
  } else {
    // Activate the first employee if none are active
    const hasActive = employees.some((e: { status: string }) => e.status === 'active')
    if (!hasActive) {
      await service
        .from('ai_employees')
        .update({ status: 'active' })
        .eq('id', employees[0].id)
    }
  }

  return NextResponse.json({
    ok: true,
    tenantId: tenant.id,
    number: platformNumber,
    channelsCreated: toInsert.map(c => c.type),
    message: `Ready! Text ${platformNumber} to test SMS. Meta channels seeded with Instagram ID: ${process.env.META_INSTAGRAM_ID}, Page ID: ${process.env.META_PAGE_ID}`,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const VALID_ITEMS = ['called', 'shared', 'tested']

// Marks a post-onboarding checklist item as done for the current tenant.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { item } = await req.json().catch(() => ({}))
  if (!VALID_ITEMS.includes(item)) {
    return NextResponse.json({ error: 'Invalid item' }, { status: 400 })
  }

  const service = await createServiceClient()
  const { data: tenant } = await service
    .from('tenants')
    .select('id, onboarding_checklist')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const checklist = { ...(tenant.onboarding_checklist || {}), [item]: true }
  await service.from('tenants').update({ onboarding_checklist: checklist }).eq('id', tenant.id)

  return NextResponse.json({ ok: true, onboarding_checklist: checklist })
}

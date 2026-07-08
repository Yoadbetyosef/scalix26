import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAttention } from '@/lib/dashboard/impact'

// The single source of truth for "unresolved notifications", fetched by the client attention store
// (used by the notification bell on every page + as a live refresh for the dashboard). Returns the
// raw active attention items; the client reconciles them against dismiss/resolve state.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ items: [] }, { status: 401 })

  const svc = await createServiceClient()
  const { data: tenant } = await svc.from('tenants').select('id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant) return NextResponse.json({ items: [] })

  const items = await getAttention(tenant.id)
  return NextResponse.json({ items })
}

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { buildSnapshot } from '@/lib/amy/registry'

// A broad, tenant-scoped business snapshot for grounding the realtime voice agent
// (which can't call tools mid-conversation). Same Business Context Layer, same tenant
// isolation. Auth-gated.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: tenant } = await admin
    .from('tenants').select('id').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'no_tenant' }, { status: 404 })

  const snapshot = await buildSnapshot({ tenantId: tenant.id, db: admin })
  return NextResponse.json({ snapshot })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/assistant/actions — the caller tenant's assistant action log (newest first).
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const db = createAdminClient()
  const { data: tenant } = await db.from('tenants').select('id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'no_tenant' }, { status: 404 })

  const status = req.nextUrl.searchParams.get('status')
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '20', 10)))
  let q = db.from('assistant_actions').select('id, action_type, channel, target_id, payload, status, error_message, external_response_id, created_at, executed_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(limit)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ actions: data || [] })
}

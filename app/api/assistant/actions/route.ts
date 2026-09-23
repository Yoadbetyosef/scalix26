import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'

// GET /api/assistant/actions — the caller tenant's assistant action log (newest first).
//
// Resolved through the shared context rather than tenants.user_id: the assistant is an operational
// surface, and a team member owns no tenant, so the old lookup answered 404 for somebody who is
// plainly inside the business.
export async function GET(req: NextRequest) {
  const ctx = await requireActiveBusinessContext()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = { id: ctx.tenantId }

  const db = createAdminClient()

  const status = req.nextUrl.searchParams.get('status')
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '20', 10)))
  let q = db.from('assistant_actions').select('id, action_type, channel, target_id, payload, status, error_message, external_response_id, created_at, executed_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(limit)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ actions: data || [] })
}

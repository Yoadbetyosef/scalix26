import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAdminContext, canManageSecurity } from '@/lib/admin/rbac'
import { logAdminAction } from '@/lib/admin/audit'

// POST /api/admin/businesses/[id]/status — suspend / reactivate a business (Super Admin only).
// NOTE: this sets the account flag + audits it. Hard enforcement (blocking a suspended owner's
// requests at the middleware) is a follow-up phase.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canManageSecurity(ctx.role)) return NextResponse.json({ error: 'Super Admin only' }, { status: 403 })
  const { id } = await params

  let body: { action?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const action = body.action
  if (action !== 'suspend' && action !== 'reactivate') {
    return NextResponse.json({ error: 'action must be suspend|reactivate' }, { status: 400 })
  }

  const admin = createAdminClient()
  const suspended_at = action === 'suspend' ? new Date().toISOString() : null
  const { data: before } = await admin.from('tenants').select('suspended_at, business_name').eq('id', id).maybeSingle()
  const { error } = await admin.from('tenants').update({ suspended_at }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(ctx.email, {
    action: `business.${action}`,
    targetType: 'tenant',
    targetId: id,
    targetLabel: before?.business_name || null,
    before: { suspended_at: before?.suspended_at ?? null },
    after: { suspended_at },
  })
  return NextResponse.json({ ok: true, suspended: !!suspended_at })
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, createAdminClient } from '@/lib/supabase/server'
import { getAdminContext, canImpersonate } from '@/lib/admin/rbac'
import { logAdminAction } from '@/lib/admin/audit'

// POST /api/admin/impersonate — "Login as customer". Generates a one-time magic link for the
// business owner and returns it; the client opens it to enter the customer's real session.
// Restricted to roles that may impersonate; every use is audit-logged.
export async function POST(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canImpersonate(ctx.role)) return NextResponse.json({ error: 'Not permitted for your role' }, { status: 403 })

  let body: { tenantId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })

  const db = await createServiceClient()
  const { data: tenant } = await db.from('tenants').select('id, user_id, business_name').eq('id', body.tenantId).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'Business not found' }, { status: 404 })

  const admin = createAdminClient()
  const { data: authUser } = await admin.auth.admin.getUserById(tenant.user_id)
  const email = authUser?.user?.email
  if (!email) return NextResponse.json({ error: 'Owner has no email' }, { status: 400 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  const { data: link, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${appUrl}/dashboard` },
  })
  if (error || !link?.properties?.action_link) {
    return NextResponse.json({ error: error?.message || 'Could not create session' }, { status: 500 })
  }

  await logAdminAction(ctx.email, {
    action: 'impersonate',
    targetType: 'tenant',
    targetId: tenant.id,
    targetLabel: tenant.business_name,
    after: { owner_email: email },
  })

  return NextResponse.json({ url: link.properties.action_link, owner_email: email, business_name: tenant.business_name })
}

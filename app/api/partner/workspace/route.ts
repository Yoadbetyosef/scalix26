import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getPartnerContext } from '@/lib/partner/rbac'
import { logPartnerAction } from '@/lib/partner/audit'
import { partnerOwnsTenant, ACTIVE_WS_COOKIE } from '@/lib/workspace'

// Fail-closed: only an explicit 'true' enables the operator switch (see lib/workspace.ts).
const OPERATOR_ENABLED = process.env.WL_OPERATOR_ENABLED === 'true'

// Secure active-workspace switch. Ownership is verified server-side; a client tenant id from the
// browser is NEVER trusted without confirming tenants.white_label_partner_id === this partner.
export async function POST(req: NextRequest) {
  const ctx = await getPartnerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.status === 'suspended') return NextResponse.json({ error: 'Suspended' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const jar = await cookies()

  if (b.action === 'exit') {
    jar.delete(ACTIVE_WS_COOKIE)
    await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'workspace.exit', targetType: 'tenant', targetId: null })
    return NextResponse.json({ success: true })
  }

  // switch
  if (!OPERATOR_ENABLED) return NextResponse.json({ error: 'Operator mode is disabled' }, { status: 403 })
  const tenantId = b.tenantId
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
  if (!(await partnerOwnsTenant(ctx.partnerId, tenantId))) {
    await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'workspace.switch_denied', targetType: 'tenant', targetId: tenantId })
    return NextResponse.json({ error: 'Not your workspace' }, { status: 403 })
  }
  jar.set(ACTIVE_WS_COOKIE, tenantId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 12 })
  await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'workspace.switch', targetType: 'tenant', targetId: tenantId })
  return NextResponse.json({ success: true })
}

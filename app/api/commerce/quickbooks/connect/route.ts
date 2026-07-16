import { NextRequest, NextResponse } from 'next/server'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { qboConfigured } from '@/lib/commerce/quickbooks/config'
import { authorizeUrl } from '@/lib/commerce/quickbooks/oauth'
import { signState } from '@/lib/commerce/quickbooks/state'

// Kick off the QuickBooks OAuth handshake: redirect the owner to Intuit's consent screen with a signed,
// tenant-bound `state`. Intuit redirects back to /api/commerce/quickbooks/callback.
export async function GET(req: NextRequest) {
  const c = await requireCommercePermission('module.settings_manage')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!qboConfigured()) {
    const back = new URL('/commerce/settings', req.url); back.searchParams.set('qb', 'not_configured')
    return NextResponse.redirect(back)
  }
  return NextResponse.redirect(authorizeUrl(signState(c.tenantId, Date.now())))
}

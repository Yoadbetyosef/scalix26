import { NextRequest, NextResponse } from 'next/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { qboConfigured } from '@/lib/commerce/quickbooks/config'
import { authorizeUrl } from '@/lib/commerce/quickbooks/oauth'
import { signState } from '@/lib/commerce/quickbooks/state'

// Start the QuickBooks OAuth handshake. A general per-tenant business integration (like Stripe/Calendar) —
// tenant-gated, not commerce-gated — so it works from onboarding. Carries the agent id so the callback
// returns to the page the user started from.
export async function GET(req: NextRequest) {
  const c = await requireActiveBusinessContext()
  if (!c?.tenantId) return NextResponse.redirect(new URL('/auth/login', req.url))
  const agentId = req.nextUrl.searchParams.get('agentId') || ''
  const back = agentId ? `/ai-employees/${agentId}` : '/commerce/settings'
  if (!qboConfigured()) {
    const u = new URL(back, req.url); u.searchParams.set('qb', 'not_configured')
    return NextResponse.redirect(u)
  }
  return NextResponse.redirect(authorizeUrl(signState(c.tenantId, Date.now(), agentId)))
}

import { NextRequest, NextResponse } from 'next/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { QBO, qboConfigured } from '@/lib/quickbooks/config'
import { authorizeUrl } from '@/lib/quickbooks/oauth'
import { signState } from '@/lib/quickbooks/state'

// Start the QuickBooks OAuth handshake. A general per-tenant business integration (like Stripe/Calendar) —
// tenant-gated, not commerce-gated — so it works from onboarding. Carries the agent id so the callback
// returns to the page the user started from.
export async function GET(req: NextRequest) {
  const c = await requireActiveBusinessContext()
  if (!c?.tenantId) return NextResponse.redirect(new URL('/auth/login', req.url))
  const agentId = req.nextUrl.searchParams.get('agentId') || ''
  const back = agentId ? `/ai-employees/${agentId}` : '/ai-employees'
  if (!qboConfigured()) {
    const u = new URL(back, req.url); u.searchParams.set('qb', 'not_configured')
    return NextResponse.redirect(u)
  }
  const url = authorizeUrl(signState(c.tenantId, Date.now(), agentId))
  // TEMPORARY DIAGNOSTIC — remove once the redirect_uri mismatch is resolved.
  // JSON.stringify is the point: it renders an invisible trailing "\n" or " " visibly, which is the
  // difference between a value that looks correct in a dashboard and one Intuit rejects.
  // The authorize URL carries client_id and the signed state — no secret. client_id is visible in the
  // browser's address bar during this very redirect, so the log adds no exposure the user doesn't see.
  console.log('[QBO] redirect_uri raw:', JSON.stringify(QBO.redirectUri))
  console.log('[QBO] full authorize URL:', url)
  return NextResponse.redirect(url)
}

import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canManageBilling } from '@/lib/partner/roles'
import { getExpressStatus, createOnboardingLink, isConnectConfigured } from '@/lib/partner/connect'

const PARTNER_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.scalix26.com'

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const status = await getExpressStatus(ctx.partnerId)
  return NextResponse.json(status)
}

// Start (or resume) Express onboarding — returns a hosted Stripe link. NEVER hard-fails: when Connect
// isn't configured (or Stripe rejects), returns { configured: false } so the UI shows a clean manual
// payout state instead of a raw error.
export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageBilling(ctx)) return NextResponse.json({ error: 'Only the owner or finance role can set up payouts.', role_blocked: true }, { status: 403 })
  if (!isConnectConfigured()) return NextResponse.json({ configured: false })
  try {
    const url = await createOnboardingLink(ctx.partnerId, `${PARTNER_APP_URL}/partner/commissions?connected=1`, `${PARTNER_APP_URL}/partner/commissions?refresh=1`)
    return NextResponse.json({ url, configured: true })
  } catch {
    // Connect enabled in env but Stripe rejected (e.g. Connect not fully provisioned) — degrade cleanly.
    return NextResponse.json({ configured: false })
  }
}

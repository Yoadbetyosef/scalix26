import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canManageBilling } from '@/lib/partner/roles'
import { getExpressStatus, createOnboardingLink } from '@/lib/partner/connect'

const PARTNER_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.scalix26.com'

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const status = await getExpressStatus(ctx.partnerId)
  return NextResponse.json(status)
}

// Start (or resume) Express onboarding — returns a hosted Stripe link.
export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageBilling(ctx)) return NextResponse.json({ error: 'Only the owner/finance can set up payouts.' }, { status: 403 })
  try {
    const url = await createOnboardingLink(ctx.partnerId, `${PARTNER_APP_URL}/partner/commissions?connected=1`, `${PARTNER_APP_URL}/partner/commissions?refresh=1`)
    return NextResponse.json({ url })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Could not start onboarding.' }, { status: 400 })
  }
}

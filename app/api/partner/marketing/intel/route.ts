import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { computeMarketingIntel } from '@/lib/partner/marketing-intel'

// Always-on Marketing Intelligence recommendations (deterministic, no LLM, no cost).
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const recs = await computeMarketingIntel(ctx.partnerId)
  return NextResponse.json({ recs })
}

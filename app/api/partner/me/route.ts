import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'

// Current partner context — works with either a session or a Bearer API key.
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Not an active partner.' }, { status: 401 })
  return NextResponse.json({
    partnerId: ctx.partnerId, partnerType: ctx.partnerType, role: ctx.role,
    status: ctx.status, companyName: ctx.companyName, slug: ctx.slug,
  })
}

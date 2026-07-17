import { NextResponse } from 'next/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { getStatus } from '@/lib/quickbooks/connection'

// Connection status for the onboarding QuickBooks card (safe fields only — never tokens).
export async function GET() {
  const c = await requireActiveBusinessContext()
  if (!c?.tenantId) return NextResponse.json({ connected: false })
  return NextResponse.json(await getStatus(c.tenantId))
}

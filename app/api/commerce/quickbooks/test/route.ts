import { NextResponse } from 'next/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { testConnection } from '@/lib/commerce/quickbooks/connection'

// Health check — refreshes the token if needed and reads CompanyInfo.
export async function POST() {
  const c = await requireActiveBusinessContext()
  if (!c?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const r = await testConnection(c.tenantId)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

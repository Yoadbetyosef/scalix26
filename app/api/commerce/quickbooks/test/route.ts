import { NextResponse } from 'next/server'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { testConnection } from '@/lib/commerce/quickbooks/connection'

// Health check from the settings card — refreshes the token if needed and reads CompanyInfo.
export async function POST() {
  const c = await requireCommercePermission('module.settings_manage')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await testConnection(c.tenantId)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

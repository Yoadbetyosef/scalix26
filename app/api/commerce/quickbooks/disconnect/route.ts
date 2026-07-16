import { NextResponse } from 'next/server'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { disconnect } from '@/lib/commerce/quickbooks/connection'

export async function POST() {
  const c = await requireCommercePermission('module.settings_manage')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await disconnect(c.tenantId)
  return NextResponse.json({ ok: true })
}

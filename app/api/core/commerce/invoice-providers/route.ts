import { NextResponse } from 'next/server'
import { requireCore } from '@/lib/core/guard'
import { listInvoiceProviders } from '@/lib/core/commerce-settings'

// Which invoice providers are usable for this tenant right now (connected/enabled), + the default.
export async function GET() {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(await listInvoiceProviders(c.tenantId))
}

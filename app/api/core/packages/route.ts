import { NextResponse } from 'next/server'
import { requireCore } from '@/lib/core/guard'
import { listPackages, listInstalledPackages } from '@/lib/core/packages'

// The vertical schema-package catalog for the active tenant: what's available to install and what's
// already installed (with upgrade-available flags). Tenant comes from the guard, never the client.
export async function GET() {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [available, installed] = await Promise.all([listPackages(), listInstalledPackages(c.tenantId)])
  return NextResponse.json({ available, installed })
}

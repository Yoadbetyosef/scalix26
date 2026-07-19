import { NextRequest, NextResponse } from 'next/server'
import { requireCoreTenant } from '@/lib/core/guard'
import { listContacts } from '@/lib/core/contacts'

// GET /api/core/contacts?archived=1 — the tenant's contacts (customers). Contacts are auto-populated from
// conversations; this is the directory view. Tenant from the guard; gated by the contacts module.
export async function GET(req: NextRequest) {
  const c = await requireCoreTenant('contacts')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const includeArchived = new URL(req.url).searchParams.get('archived') === '1'
  return NextResponse.json({ contacts: await listContacts(c.tenantId, { includeArchived }) })
}

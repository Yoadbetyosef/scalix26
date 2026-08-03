import { NextRequest, NextResponse } from 'next/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { searchContacts } from '@/lib/contacts/store'

// Type-ahead behind the order form's customer picker. Tenant-scoped by searchContacts itself.
export async function GET(req: NextRequest) {
  const c = await requireActiveBusinessContext()
  if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = req.nextUrl.searchParams.get('q') ?? ''
  return NextResponse.json({ contacts: await searchContacts(q) })
}

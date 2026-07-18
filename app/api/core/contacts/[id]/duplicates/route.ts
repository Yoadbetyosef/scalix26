import { NextRequest, NextResponse } from 'next/server'
import { requireCoreTenant } from '@/lib/core/guard'
import { findContactDuplicates } from '@/lib/core/contacts'

// Suggested duplicate contacts (scored by normalized phone/email/name overlap).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ duplicates: await findContactDuplicates(c.tenantId, (await params).id) })
}

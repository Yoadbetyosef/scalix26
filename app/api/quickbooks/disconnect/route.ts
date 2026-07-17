import { NextResponse } from 'next/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { disconnect } from '@/lib/quickbooks/connection'

export async function POST() {
  const c = await requireActiveBusinessContext()
  if (!c?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await disconnect(c.tenantId)
  return NextResponse.json({ ok: true })
}

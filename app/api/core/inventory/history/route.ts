import { NextRequest, NextResponse } from 'next/server'
import { requireCore } from '@/lib/core/guard'
import { getLedger, type ItemKind } from '@/lib/core/inventory'

const KINDS = ['product', 'variant', 'component']
export async function GET(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const itemKind = req.nextUrl.searchParams.get('itemKind') ?? ''
  const itemId = req.nextUrl.searchParams.get('itemId') ?? ''
  if (!KINDS.includes(itemKind) || !itemId) return NextResponse.json({ error: 'Invalid item' }, { status: 400 })
  return NextResponse.json({ ledger: await getLedger(c.tenantId, itemKind as ItemKind, itemId) })
}

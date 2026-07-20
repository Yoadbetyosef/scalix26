import { NextRequest, NextResponse } from 'next/server'
import { requireCore } from '@/lib/core/guard'
import { getLevels, listLocations, type ItemKind } from '@/lib/core/inventory'

// GET /api/core/inventory/levels?itemKind=product&itemId=… — on-hand/reserved/available per location for an
// item, plus the tenant's locations (for the move form). Read-only; all mutations go through /move (the RPC).
const KINDS: ItemKind[] = ['product', 'variant', 'component']

export async function GET(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const url = new URL(req.url)
  const itemKind = url.searchParams.get('itemKind') as ItemKind | null
  const itemId = url.searchParams.get('itemId')
  if (!itemId || !itemKind || !KINDS.includes(itemKind)) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  const [levels, locations] = await Promise.all([getLevels(c.tenantId, itemKind, itemId), listLocations(c.tenantId)])
  return NextResponse.json({ levels, locations })
}

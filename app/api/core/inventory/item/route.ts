import { NextRequest, NextResponse } from 'next/server'
import { requireCore } from '@/lib/core/guard'
import { getItemInventory, type ItemKind } from '@/lib/core/inventory'

// Full inventory view for one item (product|variant|component): levels, incoming, notes, summary,
// effective availability, and (for components) a variant rollup. Same data everywhere it's shown.
const KINDS = ['product', 'variant', 'component']
export async function GET(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const itemKind = req.nextUrl.searchParams.get('itemKind') ?? ''
  const itemId = req.nextUrl.searchParams.get('itemId') ?? ''
  if (!KINDS.includes(itemKind) || !itemId) return NextResponse.json({ error: 'Invalid item' }, { status: 400 })
  return NextResponse.json(await getItemInventory(c.tenantId, itemKind as ItemKind, itemId))
}

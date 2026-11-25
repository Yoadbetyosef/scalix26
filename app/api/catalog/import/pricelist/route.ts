import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { importPriceListChunk, priceListChunkSchema } from '@/lib/catalog/pricelist-import'

// POST /api/catalog/import/pricelist — one chunk (≤200 products) of a supplier price list.
// See lib/catalog/pricelist-import.ts. The page sends the file chunk by chunk so no request is long.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // A price list is costs. The same line the cost card draws: whoever may not see what the business
  // pays may not write it either.
  const c = await requireActiveBusinessContext()
  if (!c || c.tenantId !== s.tenantId || !c.capabilities.canViewCosts) {
    return NextResponse.json({ error: 'You are not allowed to record costs.' }, { status: 403 })
  }
  const parsed = priceListChunkSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'That file is not a price list we can read.' }, { status: 400 })

  const result = await importPriceListChunk(s.tenantId, c.actorUserId, parsed.data)
  return NextResponse.json(result, { status: result.ok ? 200 : 409 })
}

import { NextResponse } from 'next/server'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { listShares } from '@/lib/orders/shares'

// GET /api/orders/[id]/shares — every document link ever minted for this order.
//
// Raw tokens are NOT returned and cannot be: only their SHA-256 is stored. The list exists so the
// owner can see which links are live and withdraw one, which is the only thing that ends a link.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ shares: await listShares((await params).id) })
}

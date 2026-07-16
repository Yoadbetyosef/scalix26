import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { sendToFactory } from '@/lib/commerce/purchase-orders'

const schema = z.object({ locationId: z.string().uuid() })

// Send the (approved) PO to the factory via email. The PO is not marked sent unless the provider accepts
// it; on failure the caller gets a retryable error and the PO stays approved.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCommercePermission('purchase_orders.send')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await sendToFactory((await params).id, parsed.data.locationId)
  if (!r.ok) return NextResponse.json(r, { status: r.error === 'approval_required' ? 409 : 400 })
  return NextResponse.json(r)
}

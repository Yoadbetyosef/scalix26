import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { receiveIncoming, cancelIncoming } from '@/lib/core/inventory'

// Receive (posts an atomic ledger receive at the shipment's location) or cancel a scheduled shipment.
const schema = z.object({ action: z.enum(['receive', 'cancel']) })
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = parsed.data.action === 'receive' ? await receiveIncoming(c.tenantId, id, c.actor) : await cancelIncoming(c.tenantId, id)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

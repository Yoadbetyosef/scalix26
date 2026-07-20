import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { convertProposalToOrder } from '@/lib/core/proposals'
import { createInvoiceFromProposal } from '@/lib/core/invoice-providers'

// "Create order" → an internal operational Order (NOT an invoice). Optionally also create an invoice via the
// provider-aware flow. Idempotent (duplicate clicks return the existing order); no inventory decrement.
const schema = z.object({ alsoInvoice: z.boolean().optional(), provider: z.enum(['scalix', 'quickbooks', 'stripe']).optional() })
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const order = await convertProposalToOrder(c.tenantId, c.actor, id)
  if (!order.ok) return NextResponse.json(order, { status: 400 })
  let invoice = null
  if (parsed.data.alsoInvoice) {
    const inv = await createInvoiceFromProposal(c.tenantId, c.actor, id, { provider: parsed.data.provider ?? 'scalix', appUrl: req.nextUrl.origin })
    invoice = inv.ok ? { invoiceId: inv.invoiceId, provider: inv.provider, sync_status: inv.sync_status } : { error: inv.error }
  }
  return NextResponse.json({ ok: true, orderId: order.orderId, orderNumber: order.orderNumber, idempotent: order.idempotent, invoice })
}

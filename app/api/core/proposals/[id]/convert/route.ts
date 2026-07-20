import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { convertProposalToInvoice, convertProposalToOrder } from '@/lib/core/proposals'

// Convert an (accepted) proposal to an Invoice (Core) or Order (legacy fulfilment). Idempotent per target.
const schema = z.object({ target: z.enum(['invoice', 'order']) })
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = parsed.data.target === 'invoice'
    ? await convertProposalToInvoice(c.tenantId, c.actor, id)
    : await convertProposalToOrder(c.tenantId, c.actor, id)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

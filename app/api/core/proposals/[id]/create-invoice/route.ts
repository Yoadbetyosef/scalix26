import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { createInvoiceFromProposal } from '@/lib/core/invoice-providers'

// Provider-aware "Create invoice": always creates the internal Core invoice, then syncs QuickBooks / attaches
// a Stripe payment link per the chosen provider. Idempotent (repeat clicks return the existing conversion).
const schema = z.object({ provider: z.enum(['scalix', 'quickbooks', 'stripe']) })
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Choose an invoice provider.' }, { status: 400 })
  const r = await createInvoiceFromProposal(c.tenantId, c.actor, id, { provider: parsed.data.provider, appUrl: req.nextUrl.origin })
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

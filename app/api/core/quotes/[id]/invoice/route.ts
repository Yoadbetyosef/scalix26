import { NextRequest, NextResponse } from 'next/server'
import { requireCoreTenant } from '@/lib/core/guard'
import { quoteToInvoice } from '@/lib/core/quotes'

// POST — make the invoice this quote becomes. A draft invoice; one per quote.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('invoices')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const r = await quoteToInvoice(c.tenantId, id, c.actor)
  return NextResponse.json(r.ok ? r : { ok: false, error: r.error === 'not_found' ? 'That quote no longer exists.' : r.error }, { status: r.ok ? 200 : 400 })
}

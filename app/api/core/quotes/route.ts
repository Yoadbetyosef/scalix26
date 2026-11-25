import { NextRequest, NextResponse } from 'next/server'
import { requireCoreTenant } from '@/lib/core/guard'
import { createQuote } from '@/lib/core/quotes'
import { quoteContentSchema, QUOTE_ERR } from './shared'

// POST /api/core/quotes — create a quote with everything on it. Gated on the same module as invoices:
// a quote is the step before one.
export async function POST(req: NextRequest) {
  const c = await requireCoreTenant('invoices')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = quoteContentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Something on the quote is not valid.' }, { status: 400 })
  const r = await createQuote(c.tenantId, parsed.data, c.actor)
  return NextResponse.json(r.ok ? r : { ok: false, error: QUOTE_ERR[r.error] ?? r.error }, { status: r.ok ? 200 : 400 })
}

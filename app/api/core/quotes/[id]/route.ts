import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { saveQuote, deleteQuote } from '@/lib/core/quotes'
import { quoteContentSchema, QUOTE_ERR } from '../shared'

const isId = (id: string) => z.string().uuid().safeParse(id).success

// PUT — save the whole quote. Allowed until the customer accepts it, sent or not.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('invoices')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  if (!isId(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = quoteContentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Something on the quote is not valid.' }, { status: 400 })
  const r = await saveQuote(c.tenantId, id, parsed.data, c.actor)
  return NextResponse.json(r.ok ? r : { ok: false, error: QUOTE_ERR[r.error] ?? r.error }, { status: r.ok ? 200 : r.error === 'not_found' ? 404 : 409 })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('invoices')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  if (!isId(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await deleteQuote(c.tenantId, id)
  return NextResponse.json(r.ok ? r : { ok: false, error: QUOTE_ERR[r.error] ?? 'Could not delete it.' }, { status: r.ok ? 200 : r.error === 'not_found' ? 404 : 409 })
}

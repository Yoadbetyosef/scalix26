import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { readInvoiceSettings, writeInvoiceSettings } from '@/lib/core/invoice-settings'

// The tenant's payment details and net terms. Gated on the `invoices` module through
// requireCoreTenant — a business that does not invoice has no use for either.
export async function GET() {
  const c = await requireCoreTenant('invoices')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(await readInvoiceSettings(c.tenantId))
}

const schema = z.object({
  // Multi-line and free — bank details are a shape as much as a string.
  paymentInstructions: z.string().max(2000).nullable().optional(),
  netDays: z.number().int().min(0).max(365).optional(),
})

export async function PATCH(req: NextRequest) {
  const c = await requireCoreTenant('invoices')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })

  const current = await readInvoiceSettings(c.tenantId)
  const r = await writeInvoiceSettings(c.tenantId, {
    paymentInstructions: parsed.data.paymentInstructions ?? current.paymentInstructions,
    netDays: parsed.data.netDays ?? current.netDays,
  }, c.actor)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}

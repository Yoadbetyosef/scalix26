import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { addLine, tenantSalesTax, type DocType } from '@/lib/core/documents'
import { lineTaxCents } from '@/lib/core/sales-tax'

// Four, matching DocType. It shipped with three while DocType had four — the same drift already
// corrected in the payments route, and the kind that is invisible until somebody adds a proposal line
// and gets 'Invalid type' with nothing wrong at the call site.
const TYPES = ['estimate', 'quote', 'invoice', 'proposal'] as const
const schema = z.object({
  productId: z.string().uuid().nullable().optional(), variantId: z.string().uuid().nullable().optional(), componentId: z.string().uuid().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  quantity: z.number().nonnegative(), unit_price_cents: z.number().int(),
  discount_cents: z.number().int().nonnegative().optional(), tax_cents: z.number().int().nonnegative().optional(),
  customAttributes: z.record(z.string(), z.unknown()).optional(),
  /** Tax at the TENANT'S rate, computed here. Wins over tax_cents — the caller does not do the sum. */
  taxable: z.boolean().optional(),
})
export async function POST(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { type, id } = await params
  if (!(TYPES as readonly string[]).includes(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { taxable, ...line } = parsed.data
  if (taxable) {
    const tax = await tenantSalesTax(c.tenantId)
    if (!tax) return NextResponse.json({ ok: false, error: 'There is no sales-tax rate for this business\'s state.' }, { status: 400 })
    line.tax_cents = lineTaxCents(line, tax.rate)
  }
  const r = await addLine(c.tenantId, type as DocType, id, line)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

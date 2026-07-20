import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { getCommerceSettings, setCommerceSettings } from '@/lib/core/commerce-settings'

export async function GET() {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ settings: await getCommerceSettings(c.tenantId) })
}

const schema = z.object({
  default_invoice_provider: z.enum(['scalix', 'quickbooks', 'stripe']).optional(),
  invoice_send_by_default: z.boolean().optional(),
  default_payment_terms_days: z.number().int().min(0).max(365).optional(),
  default_tax_behavior: z.enum(['none', 'inclusive', 'exclusive']).optional(),
  default_invoice_email_message: z.string().max(4000).nullable().optional(),
})
export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid settings' }, { status: 400 })
  const r = await setCommerceSettings(c.tenantId, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { getBranding, setBranding } from '@/lib/core/proposal-branding'

// Tenant proposal branding (logo, contact, accent, default copy). GET returns the effective (merged) values.
export async function GET() {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ branding: await getBranding(c.tenantId) })
}

const schema = z.object({
  logo_url: z.string().url().nullable().optional(), business_name: z.string().max(300).nullable().optional(),
  address: z.string().max(1000).nullable().optional(), phone: z.string().max(60).nullable().optional(),
  email: z.string().max(320).nullable().optional(), website: z.string().max(300).nullable().optional(),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), header_style: z.enum(['standard', 'centered', 'band']).optional(),
  footer_text: z.string().max(2000).nullable().optional(), intro: z.string().max(4000).nullable().optional(),
  default_terms: z.string().max(8000).nullable().optional(), default_email_subject: z.string().max(300).nullable().optional(),
  default_email_message: z.string().max(4000).nullable().optional(),
})
export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid branding values' }, { status: 400 })
  const r = await setBranding(c.tenantId, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

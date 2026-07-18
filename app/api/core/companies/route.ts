import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { listCompanies, createCompany } from '@/lib/core/companies'

export async function GET() {
  const c = await requireCoreTenant()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ companies: await listCompanies(c.tenantId) })
}

const schema = z.object({
  name: z.string().min(1).max(300),
  domain: z.string().max(300).nullable().optional(), email: z.string().email().max(320).nullable().optional(),
  phone: z.string().max(50).nullable().optional(), address: z.string().max(1000).nullable().optional(), notes: z.string().max(5000).nullable().optional(),
})
export async function POST(req: NextRequest) {
  const c = await requireCoreTenant()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createCompany(c.tenantId, c.actor, parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ company: r.company })
}

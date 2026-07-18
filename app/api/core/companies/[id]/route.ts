import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { updateCompany, archiveCompany } from '@/lib/core/companies'

const schema = z.object({
  name: z.string().min(1).max(300).optional(), domain: z.string().max(300).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(), phone: z.string().max(50).nullable().optional(),
  address: z.string().max(1000).nullable().optional(), notes: z.string().max(5000).nullable().optional(),
})
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const company = await updateCompany(c.tenantId, (await params).id, parsed.data)
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ company })
}

// DELETE = archive (non-destructive, keeps history).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ok = await archiveCompany(c.tenantId, (await params).id, true)
  return NextResponse.json({ ok })
}

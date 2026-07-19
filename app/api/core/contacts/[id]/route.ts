import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { getContact, updateContactCore } from '@/lib/core/contacts'

// GET /api/core/contacts/[id] — one contact. PATCH — edit core fields (keeps normalized dedupe keys in sync).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('contacts')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const contact = await getContact(c.tenantId, (await params).id)
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ contact })
}

const schema = z.object({
  name: z.string().min(1).max(300).optional(), phone: z.string().max(50).nullable().optional(), email: z.string().max(320).nullable().optional(),
})
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('contacts')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const ok = await updateContactCore(c.tenantId, (await params).id, parsed.data)
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 })
}

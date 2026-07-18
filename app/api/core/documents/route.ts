import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { createDocument } from '@/lib/core/documents'

const schema = z.object({
  type: z.enum(['estimate', 'quote', 'invoice']),
  contactId: z.string().uuid().nullable().optional(), companyId: z.string().uuid().nullable().optional(),
  currency: z.string().max(10).optional(), notes: z.string().max(10000).nullable().optional(),
})
export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { type, ...input } = parsed.data
  const r = await createDocument(c.tenantId, type, input, c.actor)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

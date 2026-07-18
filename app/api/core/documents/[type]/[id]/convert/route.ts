import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { convertDocument } from '@/lib/core/convert'

// Convert this document to a target type (idempotent). Estimate→Quote, Estimate/Quote/Order→Invoice.
const schema = z.object({ targetType: z.enum(['quote', 'invoice']), idempotencyKey: z.string().min(1).max(200) })
export async function POST(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { type, id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await convertDocument(c.tenantId, type, id, parsed.data.targetType, parsed.data.idempotencyKey, c.actor)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

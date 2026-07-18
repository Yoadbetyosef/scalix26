import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { listNumberingRules, updateNumberingRule } from '@/lib/core/config'

export async function GET() {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ rules: await listNumberingRules(c.tenantId) })
}

const schema = z.object({ docType: z.string().min(1).max(40), prefix: z.string().max(20).optional(), padding: z.number().int().optional(), nextNumber: z.number().int().optional() })
export async function PUT(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { docType, ...patch } = parsed.data
  const r = await updateNumberingRule(c.tenantId, docType, patch)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

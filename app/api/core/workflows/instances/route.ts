import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { startInstance } from '@/lib/core/workflow'

const schema = z.object({ workflowDefinitionId: z.string().uuid(), recordType: z.string().min(1).max(40), recordId: z.string().uuid() })
export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await startInstance(c.tenantId, parsed.data.workflowDefinitionId, parsed.data.recordType, parsed.data.recordId)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

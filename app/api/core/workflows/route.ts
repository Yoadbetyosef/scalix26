import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { createWorkflow } from '@/lib/core/workflow'

const schema = z.object({
  key: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/), name: z.string().min(1).max(200), recordType: z.string().min(1).max(40),
  stages: z.array(z.object({ key: z.string().min(1).max(60), label: z.string().min(1).max(200), isInitial: z.boolean().optional(), isTerminal: z.boolean().optional(), isSuccess: z.boolean().optional(), isFailed: z.boolean().optional() })).min(1),
  transitions: z.array(z.object({ from: z.string().nullable(), to: z.string() })),
})
export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createWorkflow(c.tenantId, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

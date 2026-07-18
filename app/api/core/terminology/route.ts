import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { getTerminology, setTermOverride } from '@/lib/core/terminology'

export async function GET() {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ terminology: await getTerminology(c.tenantId) })
}

// Only supported business nouns can be relabeled — the repo rejects anything else (system actions safe).
const schema = z.object({ nounKey: z.string().min(1).max(40), singular: z.string().max(60).nullable().optional(), plural: z.string().max(60).nullable().optional() })
export async function PUT(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { nounKey, ...value } = parsed.data
  const r = await setTermOverride(c.tenantId, nounKey, value)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

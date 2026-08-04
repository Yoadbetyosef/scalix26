import { NextRequest, NextResponse } from 'next/server'
import { getCost, saveCost } from '@/lib/catalog/costs'
import { costPayloadSchema } from '@/app/api/catalog/products/[id]/cost/route'

// Cost and margin for a sub-product. Deliberately the same store, the same payload schema and the same
// refusal semantics as the product endpoint — only the target differs. A second copy of any of those
// would be a second place for the rules to drift.
//
// 403 when this session may not see costs; 200 with cost:null when nothing has been recorded yet.

const fail = (reason: 'not_found' | 'forbidden') =>
  reason === 'forbidden'
    ? NextResponse.json({ error: 'You do not have permission to view product costs.' }, { status: 403 })
    : NextResponse.json({ error: 'Not found' }, { status: 404 })

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await getCost({ kind: 'variant', id: (await params).id })
  if (!r.ok) return fail(r.reason)
  return NextResponse.json(r.data)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = costPayloadSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  try {
    const r = await saveCost({ kind: 'variant', id: (await params).id }, parsed.data)
    if (!r.ok) return fail(r.reason)
    return NextResponse.json(r.data)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Could not save the cost' }, { status: 400 })
  }
}

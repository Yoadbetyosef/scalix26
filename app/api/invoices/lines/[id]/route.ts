import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { setLineMatch, suggestForLine } from '@/lib/invoices/store'

// One invoice line: what product it refers to, or that the owner has decided it refers to nothing.
//
// Every change here re-runs the allocation across the WHOLE invoice, because the allocation is a
// function of which lines are matched — moving one line moves every other line's share. The response is
// therefore the whole shipment, not the line: a client patching one row and updating one row locally
// would show an allocation that no longer sums to what was paid.

const schema = z.object({
  productId: z.string().uuid().nullable().optional(),
  // Deliberate exclusion, distinct from "we could not match it". Both leave the allocation denominator;
  // only one of them is a problem the owner can fix.
  skip: z.boolean().optional(),
}).strict()

const fail = (reason: 'not_found' | 'forbidden') =>
  reason === 'forbidden'
    ? NextResponse.json({ error: 'You do not have permission to change supplier costs.' }, { status: 403 })
    : NextResponse.json({ error: 'Not found' }, { status: 404 })

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await suggestForLine((await params).id)
  if (!r.ok) return fail(r.reason)
  return NextResponse.json({ suggestions: r.data })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const r = await setLineMatch((await params).id, parsed.data.productId ?? null, Boolean(parsed.data.skip))
  if (!r.ok) return fail(r.reason)
  return NextResponse.json(r.data)
}

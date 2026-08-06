import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getShipment, setCharges } from '@/lib/invoices/store'

const money = z.number().min(0).max(1_000_000_000)

// .strict(), like the cost endpoint: an unexpected key is a 400 rather than a silent drop. The
// allocation is not accepted from a request at all — it is derived from these charges plus which lines
// are matched, and a client that could post it directly could post one that does not add up.
const schema = z.object({
  freightTotal: money.optional(),
  dutiesTotal: money.optional(),
  otherTotal: money.optional(),
  reference: z.string().max(200).optional(),
}).strict()

const fail = (reason: 'not_found' | 'forbidden', error?: string) =>
  reason === 'forbidden'
    ? NextResponse.json({ error: error || 'You do not have permission to view supplier costs.' }, { status: 403 })
    : NextResponse.json({ error: error || 'Not found' }, { status: 404 })

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await getShipment((await params).id)
  if (!r.ok) return fail(r.reason, r.error)
  return NextResponse.json(r.data)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })

  const r = await setCharges((await params).id, parsed.data)
  if (!r.ok) return fail(r.reason, r.error)
  return NextResponse.json(r.data)
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getShipment, setShipmentInputs } from '@/lib/invoices/store'

const money = z.number().min(0).max(1_000_000_000)

// .strict(), like the cost endpoint: an unexpected key is a 400 rather than a silent drop. The
// allocation is not accepted from a request at all — it is derived from these charges plus which lines
// are matched, and a client that could post it directly could post one that does not add up.
const schema = z.object({
  // The forwarder's bill, in the tenant's base currency. Never converted — see the migration header.
  freightTotal: money.optional(),
  dutiesTotal: money.optional(),
  otherTotal: money.optional(),
  reference: z.string().max(200).optional(),
  // The rate paid on THIS invoice, applied to line values only. Nullable so it can be cleared; the
  // upper bound is loose because currencies exist at every magnitude (JPY, HUF), and the meaningful
  // check — is one actually present on a foreign-currency invoice — is enforced in SQL at Apply, where
  // it cannot be skipped by a client.
  exchangeRate: z.number().positive().max(1_000_000).nullable().optional(),
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

  const r = await setShipmentInputs((await params).id, parsed.data)
  if (!r.ok) return fail(r.reason, r.error)
  return NextResponse.json(r.data)
}

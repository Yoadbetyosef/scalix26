import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getProductCost, saveProductCost } from '@/lib/catalog/costs'

// Cost and margin for one product, on its own endpoint.
//
// Cost never rides along in the catalog payload. If it did, "hidden" would mean hidden in the browser,
// and the data would already have left the server. A caller who may not see costs gets 403 here — an
// explicit refusal, deliberately distinguishable from 200-with-nothing, which is what "no cost recorded
// yet" looks like. The two are different facts and must not answer the same.

const money = z.number().min(0).max(1_000_000_000)

// .strict(): an unexpected key is a 400, not a silent drop. Zod would strip `markupPercent` by default
// and the request would appear to succeed — this way a client trying to send one finds out, and so do
// we. Both omitted fields are omitted on purpose:
//
//   markupPercent — snapshotted server-side (today's tenant default on insert, preserved untouched on
//   update, changed only by the explicit applyCurrentMarkup call). Accepting it from a request would
//   let one malformed call rewrite the snapshot on an existing row and shift a historical cost, which
//   is the exact failure the snapshot exists to prevent.
//
//   computedCost — a generated column. The database derives it; nothing may write it.
export const costPayloadSchema = z.object({
  costPrimary: money.nullable().optional(),
  costSecondary: money.nullable().optional(),
  shippingCost: money.optional(),
  tariffCost: money.optional(),
}).strict()

const schema = costPayloadSchema

const fail = (reason: 'not_found' | 'forbidden') =>
  reason === 'forbidden'
    ? NextResponse.json({ error: 'You do not have permission to view product costs.' }, { status: 403 })
    : NextResponse.json({ error: 'Not found' }, { status: 404 })

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await getProductCost((await params).id)
  if (!r.ok) return fail(r.reason)
  return NextResponse.json(r.data)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  try {
    const r = await saveProductCost((await params).id, parsed.data)
    if (!r.ok) return fail(r.reason)
    return NextResponse.json(r.data)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Could not save the cost' }, { status: 400 })
  }
}

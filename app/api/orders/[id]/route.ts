import { NextRequest, NextResponse } from 'next/server'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { patchOrderSchema } from '@/lib/orders/schema'
import { getOrder, updateOrder, deleteOrder } from '@/lib/orders/store'
import { refusedFields } from '@/lib/orders/stages'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const order = await getOrder((await params).id)
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ order })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = patchOrderSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })

  // ── THE STAGE RULE, ENFORCED HERE RATHER THAN HIDDEN IN THE PAGE ───────────────────────────────
  //
  // This route had NO stage check. The only thing stopping an edit to a finished order was that the
  // page did not render the button — so the protection was a hidden control, and any other caller
  // (the attachments panel, a script, the next screen somebody builds) inherited the hole.
  //
  // Reading the order first costs a query on a route that is about to write anyway.
  const id = (await params).id
  const existing = await getOrder(id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Null = the whole edit is refused (cancelled). A non-empty array = only these keys are. The
  // decision itself lives in stages.ts beside the rest of the policy, and is unit-tested there.
  const refused = refusedFields(existing.stage, Object.keys(parsed.data))
  if (refused === null) {
    return NextResponse.json({ error: 'This order is cancelled. Nothing on it can be changed.' }, { status: 409 })
  }
  if (refused.length) {
    // Finished or completed: tax and the invoice photograph are still facts about a document that
    // exists. Everything else is workflow, and re-pricing an invoice somebody already holds is the
    // specific accident this refuses — updateOrder recomputes the subtotal whenever lineItems is sent.
    return NextResponse.json({
      error: `This order is ${existing.stage}. Its tax and invoice photo can still be corrected; ${refused.join(', ')} cannot.`,
      refused,
    }, { status: 409 })
  }

  try {
    const order = await updateOrder(id, parsed.data)
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true, order })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Failed to save' }, { status: 400 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ok = await deleteOrder((await params).id)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { expenseFieldsFrom, parseExpense } from '@/lib/expenses/schema'
import { receiptChangeFrom } from '@/lib/expenses/receipt'
import { deleteExpense, updateExpense } from '@/lib/expenses/store'

// CORRECTING AND REMOVING ONE EXPENSE.
//
// Multipart like the create route, and for the same reason: a replacement receipt travels with the
// fields, so one request either changes everything or changes nothing.
//
// ── WHY receiptAction IS A WORD RATHER THAN THE PRESENCE OF A FILE ──────────────────────────────
//
// "No file in the body" is ambiguous — it is what a person sending a merchant-name fix looks like AND
// what a person taking the photo off looks like. Inferring from absence would mean one of those two
// intents silently does the other, and the one that loses is the one that deletes proof. So the client
// says which it meant, and anything it does not say is `keep`, which is the harmless reading.
//
// The gate, the upload and the old file's removal all live in the store. This is the boundary.

const badForm = () =>
  NextResponse.json({ error: 'That upload could not be read. If the receipt is a large photo, try again.' }, { status: 400 })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return badForm()
  }

  const parsed = parseExpense(expenseFieldsFrom(form), new Date().toISOString().slice(0, 10))
  if (!parsed.ok) {
    const first = parsed.problems[0]
    return NextResponse.json({ error: first.message, field: first.field, problems: parsed.problems }, { status: 400 })
  }

  const raw = form.get('receipt')
  const file = raw instanceof File && raw.size > 0 ? raw : null

  const r = await updateExpense(id, parsed.value, receiptChangeFrom(form.get('receiptAction'), file))
  if (!r.ok) {
    return NextResponse.json({ error: r.error, field: r.field }, { status: statusFor(r.error) })
  }
  return NextResponse.json({ ok: true, expense: r.expense })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await deleteExpense((await params).id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: statusFor(r.error) })
  return NextResponse.json({ ok: true })
}

/**
 * 401 for a refused gate, 404 for a row that is not this tenant's, 400 for everything else.
 *
 * The store deliberately returns the same "no longer exists" for a missing row and for another
 * tenant's — telling those apart would let any session enumerate ids across tenants.
 */
function statusFor(error: string): number {
  if (error === 'Unauthorized') return 401
  if (error === 'That expense no longer exists.') return 404
  return 400
}

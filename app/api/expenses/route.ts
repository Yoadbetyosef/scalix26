import { NextRequest, NextResponse } from 'next/server'
import { parseExpense } from '@/lib/expenses/schema'
import { createExpense } from '@/lib/expenses/store'

// RECORDING ONE EXPENSE.
//
// Multipart rather than JSON, because the receipt travels with it. One request, so an expense and its
// receipt cannot half-save: there is no state where the photo is in the bucket and the row it belongs
// to was never written, or the reverse.
//
// The gate, the upload and the orphan cleanup all live in the store. This is the boundary: read the
// form, validate it, hand it over, translate the answer.

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    // What an over-the-limit upload looks like from in here, on the occasions it reaches the route at
    // all — usually the platform edge has already refused it with plain text. The downscale exists so
    // this is rare; the message exists so it is not baffling when it happens.
    return NextResponse.json({ error: 'That upload could not be read. If the receipt is a large photo, try again.' }, { status: 400 })
  }

  const str = (k: string) => {
    const v = form.get(k)
    return typeof v === 'string' ? v : undefined
  }

  // UTC today. The schema allows a day of tolerance either side precisely so this does not have to
  // resolve the tenant's timezone to decide whether a receipt bought this evening is "in the future".
  const parsed = parseExpense(
    { spentOn: str('spentOn'), merchant: str('merchant'), amount: str('amount'), tax: str('tax'), category: str('category'), note: str('note') },
    new Date().toISOString().slice(0, 10),
  )
  if (!parsed.ok) {
    const first = parsed.problems[0]
    return NextResponse.json({ error: first.message, field: first.field, problems: parsed.problems }, { status: 400 })
  }

  const raw = form.get('receipt')
  const file = raw instanceof File && raw.size > 0 ? raw : null

  const r = await createExpense(parsed.value, file)
  if (!r.ok) {
    return NextResponse.json({ error: r.error, field: r.field }, { status: r.error === 'Unauthorized' ? 401 : 400 })
  }
  return NextResponse.json({ ok: true, expense: r.expense })
}

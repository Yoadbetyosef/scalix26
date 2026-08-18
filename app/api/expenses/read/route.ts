import { NextRequest, NextResponse } from 'next/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { enforce } from '@/lib/ratelimit'
import { canBeRead, RECEIPT_EXTENSIONS, receiptExtensionOf, receiptFileError } from '@/lib/expenses/receipt'
import { readReceipt } from '@/lib/expenses/extract'

// READING A RECEIPT PHOTOGRAPH INTO A FORM.
//
// ── THIS ROUTE STORES NOTHING ───────────────────────────────────────────────────────────────────
//
// It takes bytes, returns fields, and forgets them. The photograph is uploaded a second time by
// POST /api/expenses when the person actually saves — which is the whole reason this one can be so
// simple. The alternative, storing here and linking at save, needs a reaper for every photograph
// somebody read and then abandoned, and would break the invariant createExpense was built around:
// the bucket never holds a file nothing points at.
//
// The second upload is not free, and it is deliberately placed where it costs least. The copy sent
// HERE is the small one (1600px, ~200 KB) and it is the one a person waits on; the full copy goes at
// save, behind a button they have already pressed. See lib/expenses/downscale.ts.
//
// ── AND IT IS GATED LIKE EVERYTHING ELSE THAT SPENDS ────────────────────────────────────────────
//
// canViewCosts, because a White Label operator who may not see what a business pays in rent may not
// read its receipts either. Rate limited per TENANT, because this is the only surface in the
// application where one tap spends model money — an ungated one is an uncapped spend hole wearing a
// camera button.
//
// 30s, not the 300s the invoice upload uses. A fifteen-page invoice earns five minutes; a person
// holding a phone does not, and a request still running at thirty seconds has already lost. The
// client gives up at twenty and falls back to typing.
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const ctx = await requireActiveBusinessContext()
  if (!ctx || !ctx.capabilities.canViewCosts) {
    return NextResponse.json({ error: 'You do not have permission to do that.' }, { status: 403 })
  }

  const limited = await enforce('expense_read', ctx.tenantId)
  if (limited) return limited

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'That photo could not be read. Fill the fields in and it still saves.' }, { status: 400 })
  }

  const raw = form.get('receipt')
  if (!(raw instanceof File) || raw.size === 0) {
    return NextResponse.json({ error: 'No photo was sent.' }, { status: 400 })
  }

  // The same limits the picker and the save route enforce. A file acceptable to one and not the next
  // is a person told their photo is fine and then told it is not.
  const problem = receiptFileError(raw.name, raw.size)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  // A HEIC that survived the redraw. The client is not supposed to send one — it checks canBeRead
  // before calling — so this is the belt for that brace, and it answers 415 rather than pretending
  // to have read nothing.
  if (!canBeRead(raw.name)) {
    return NextResponse.json({ error: 'That photo could not be prepared for reading.' }, { status: 415 })
  }

  const bytes = Buffer.from(await raw.arrayBuffer())
  const mimeType = RECEIPT_EXTENSIONS[receiptExtensionOf(raw.name)]

  try {
    // UTC today, matching the create route. resolveSpentOn allows a day past it for the same reason
    // parseExpense does: the tenant's today and the server's can differ by one across a timezone.
    const r = await readReceipt(ctx.tenantId, bytes, mimeType, new Date().toISOString().slice(0, 10))
    return NextResponse.json({ reading: r.reading })
  } catch {
    // Anything at all — a model error, a timeout, a response that would not parse. The form is
    // already open and already usable, so this is not an incident, it is a blank form. Deliberately
    // not a 500: nothing is broken from where the person is standing.
    return NextResponse.json({ reading: null }, { status: 200 })
  }
}

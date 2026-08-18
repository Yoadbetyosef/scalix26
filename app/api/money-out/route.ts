import { NextRequest, NextResponse } from 'next/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { enforce } from '@/lib/ratelimit'
import { openDoor } from '@/lib/money-out/door'

// THE ONE DOOR, as an endpoint. One file in, a LANDING out.
//
// It replaces nothing — POST /api/expenses and POST /api/invoices/shipments both still exist and are
// both still the way a row is finally written. What this adds is the step before either: reading the
// document and deciding which of them it is. See lib/money-out/door.ts and OUTSTANDING.md §10.
//
// ── 300s, AND THE CLIENT STILL GIVES UP EARLIER ────────────────────────────────────────────────
//
// The ceiling has to cover the long path, because a fifteen-page invoice legitimately takes minutes
// and that read is one the owner has already committed to. It is NOT a licence to keep somebody
// holding a phone waiting: the client gives up on the photo path at twenty seconds and falls back to
// the typed form, exactly as the receipt reader's own route describes. The two numbers answer
// different questions — how long the server may take, and how long a person will stand there.
//
// ── RATE LIMITED PER TENANT, ON THE SAME BUCKET AS BEFORE ──────────────────────────────────────
//
// This is the surface in the application where one tap spends model money, and now it is the ONLY
// one, which makes the cap more load-bearing rather than less. Deliberately the existing
// `expense_read` policy rather than a new one: a second bucket would let the same spend through
// twice by arriving at a different door, which is the whole class of problem this change exists to
// close.
export const maxDuration = 300

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
    // The platform edge refuses an oversized body before this route exists as far as it is
    // concerned, so this is the smaller case: a body that arrived and would not parse.
    return NextResponse.json({ error: 'That file could not be read. Fill the fields in and it still saves.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'No file was sent.' }, { status: 400 })
  }

  try {
    const r = await openDoor(file)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json(r.landing)
  } catch (e) {
    // A model error, a timeout, a response that would not parse. On the expense side the form is
    // already open and usable, so this is not an incident — it is a blank form, and the person types
    // what they already know. The bill side has its own visible failure state and never reaches here.
    return NextResponse.json({ error: (e as Error).message || 'That document could not be read.' }, { status: 400 })
  }
}

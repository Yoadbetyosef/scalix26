import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { applyShipment } from '@/lib/invoices/store'

// The one write that touches product costs.
//
// Both flags are deliberately explicit rather than inferred:
//
//   override — the owner has seen the coverage figure and chosen to apply below the threshold anyway.
//   Sending it is an act; it is never defaulted on, and the database enforces the threshold either way.
//
//   acknowledgeDivergence — one or more products' costs are about to move enough to move their
//   margins, and the owner has been shown which and by how much. Without it the apply refuses and
//   returns the flagged products so the screen can say what it is asking about. Sending it is what
//   gets recorded on the shipment, so it must never be defaulted on: a default would turn the audit
//   trail into a lie about what anyone saw.
//
//   reapply — this shipment has already been applied once. Applying again OVERWRITES what it wrote the
//   first time, so it must be asked for by name. Without it the RPC refuses and names the date of the
//   earlier apply, which is the information the owner needs to decide.

const schema = z.object({
  override: z.boolean().optional(),
  reapply: z.boolean().optional(),
  acknowledgeDivergence: z.boolean().optional(),
}).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const r = await applyShipment((await params).id, parsed.data)
  if (!r.ok) {
    if (r.reason === 'forbidden') return NextResponse.json({ error: 'You do not have permission to change product costs.' }, { status: 403 })
    // Not an error the caller got wrong — the write asking to be confirmed. The flagged products travel
    // with it so a stale tab can show what changed rather than a refusal it cannot explain.
    if (r.reason === 'divergence') {
      return NextResponse.json({ error: r.error, divergences: r.divergences, needsAcknowledgement: true }, { status: 409 })
    }
    // The RPC's guards (coverage, allocation totals, already-applied) come back as errors with messages
    // written for the owner. A 409 rather than a 404: the shipment exists, the request conflicts with
    // its state, and the message says how.
    return NextResponse.json({ error: r.error || 'Not found' }, { status: r.error ? 409 : 404 })
  }
  return NextResponse.json(r.data)
}

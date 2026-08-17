import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createProductsFromLines } from '@/lib/invoices/store'

// Turn unmatched invoice lines into products.
//
// For a business setting up from scratch the invoices ARE the catalogue. This is the endpoint that lets
// one become the other — the inverse of what the rest of this feature does, and the reason it exists at
// all for a tenant whose catalogue is empty.
//
// Products are created `draft`: they have a cost and no selling price, so the voice agent must never
// quote them. See add_landed_cost_invoices_4.sql.
//
// Bulk in the sense of "several lines in one request", NOT "create everything unmatched". The owner
// selects which lines, and may rename each one first. That is the same rule the catalog ingestion module
// already holds itself to — promotion into inventory is tenant-initiated, never automatic — and an
// invoice does not change the failure mode: a catalogue full of rows nobody chose still has to be
// cleaned up by hand afterwards.

const schema = z.object({
  lineIds: z.array(z.string().uuid()).min(1).max(500),
  // Keyed by line id. Absent means use the raw description, which is the supplier's own shorthand and
  // better evidence than anything we would invent.
  names: z.record(z.string().uuid(), z.string().max(200)).optional(),
}).strict()

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })

  const r = await createProductsFromLines(parsed.data.lineIds, parsed.data.names ?? {})
  if (!r.ok) {
    if (r.reason === 'forbidden') return NextResponse.json({ error: 'You do not have permission to change the catalogue.' }, { status: 403 })
    return NextResponse.json({ error: r.error || 'Not found' }, { status: r.error ? 409 : 404 })
  }
  return NextResponse.json(r.data)
}

import { NextRequest, NextResponse } from 'next/server'
import { requireCore } from '@/lib/core/guard'
import { issueDocument, type DocType } from '@/lib/core/documents'

// Issue a document: draft → issued, with a date, and the total frozen from that moment.
//
// Its own route rather than a value on PATCH ?status=, because issuing is not a status change that
// happens to be called "issued" — it checks there is something to issue, stamps a date, and closes
// the document to further lines. updateStatus() refuses the word for that reason.
const TYPES = ['estimate', 'quote', 'invoice', 'proposal'] as const
const parseType = (t: string): DocType | null => (TYPES as readonly string[]).includes(t) ? (t as DocType) : null

// Each refusal is a sentence the screen can show as-is. A person who pressed Issue and got
// "no_lines" would have to guess; "Add a line before issuing it" is the whole answer.
const SAY: Record<string, string> = {
  not_found: 'That document no longer exists.',
  already_issued: 'That has already been issued.',
  no_lines: 'Add a line before issuing it — an invoice with nothing on it is not an invoice.',
  no_number: 'That document has no number, so it cannot be issued.',
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { type, id } = await params
  const t = parseType(type)
  if (!t) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const r = await issueDocument(c.tenantId, t, id, c.actor)
  if (!r.ok) {
    return NextResponse.json(
      { error: SAY[r.error] ?? r.error, reason: r.error },
      { status: r.error === 'not_found' ? 404 : r.error === 'already_issued' ? 409 : 400 },
    )
  }
  return NextResponse.json({ ok: true, number: r.number, issuedAt: r.issuedAt, totalCents: r.totalCents })
}

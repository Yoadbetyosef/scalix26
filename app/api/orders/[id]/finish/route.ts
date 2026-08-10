import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { archiveToInventory, raiseInvoice } from '@/lib/orders/finish'

// POST /api/orders/[id]/finish — what happens to a completed job.
//
// Two independent actions on one route because they are the same decision point, not the same action:
// a job can be invoiced and not archived, archived and not invoiced, or both.

const schema = z.object({ action: z.enum(['invoice', 'archive']) }).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const id = (await params).id
  const r = parsed.data.action === 'invoice' ? await raiseInvoice(id) : await archiveToInventory(id)
  if (!r.ok) return NextResponse.json({ error: r.error, created: r.created }, { status: 400 })
  return NextResponse.json({ ok: true, created: r.created })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { listProposals, createProposal } from '@/lib/core/proposals'

// GET → unified list (proposals + legacy estimates/quotes). POST → create a new proposal (Draft).
export async function GET() {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ proposals: await listProposals(c.tenantId) })
}

const schema = z.object({ contactId: z.string().uuid().nullable().optional(), companyId: z.string().uuid().nullable().optional(), currency: z.string().max(10).optional() })
export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createProposal(c.tenantId, c.actor, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

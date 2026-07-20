import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { listProposals, createProposal } from '@/lib/core/proposals'

// GET → unified list (proposals + legacy estimates/quotes) with search/status/converted/type filters.
export async function GET(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const sp = req.nextUrl.searchParams
  const converted = sp.get('converted')
  const type = sp.get('type')
  return NextResponse.json({ proposals: await listProposals(c.tenantId, {
    search: sp.get('search') || undefined,
    status: sp.get('status') || undefined,
    converted: converted === 'yes' || converted === 'no' ? converted : undefined,
    type: type === 'proposal' || type === 'estimate' || type === 'quote' ? type : undefined,
  }) })
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

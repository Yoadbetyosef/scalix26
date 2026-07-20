import { NextRequest, NextResponse } from 'next/server'
import { requireCore } from '@/lib/core/guard'
import { duplicateProposal } from '@/lib/core/proposals'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const r = await duplicateProposal(c.tenantId, c.actor, id)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

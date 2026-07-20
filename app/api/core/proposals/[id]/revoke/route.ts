import { NextRequest, NextResponse } from 'next/server'
import { requireCore } from '@/lib/core/guard'
import { revokeProposalToken } from '@/lib/core/proposals'

// Revoke the public link (the token page stops resolving). A later Send issues a fresh link.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const ok = await revokeProposalToken(c.tenantId, id)
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 })
}

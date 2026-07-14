import { NextRequest, NextResponse } from 'next/server'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { revokeApproval } from '@/lib/orders/approvals'

// Revoke an approval request — its token becomes non-actionable.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ok = await revokeApproval((await params).requestId)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

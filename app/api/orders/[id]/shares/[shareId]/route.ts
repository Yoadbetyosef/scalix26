import { NextResponse } from 'next/server'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { revokeShare } from '@/lib/orders/shares'

// DELETE /api/orders/[id]/shares/[shareId] — withdraw a shared-document link.
//
// DELETE rather than POST because the thing being removed is the link's validity, and the route
// reads as what it does. The row survives: an audit of who was sent what, and when it was withdrawn,
// is the reason revocation is a timestamp rather than a deletion.
//
// Tenancy is enforced inside revokeShare on the UPDATE itself, so a share id from another tenant
// matches no row rather than being read and then trusted.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; shareId: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await revokeShare((await params).shareId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}

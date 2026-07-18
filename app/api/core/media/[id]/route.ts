import { NextRequest, NextResponse } from 'next/server'
import { requireCoreTenant } from '@/lib/core/guard'
import { deleteMedia } from '@/lib/core/media'

// DELETE /api/core/media/[id] — remove a media entry. Commerce-gated; tenant-scoped delete.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: await deleteMedia(c.tenantId, (await params).id) })
}

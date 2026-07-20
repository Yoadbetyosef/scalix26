import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { setLineImage } from '@/lib/core/proposals'

// Per-line image controls: hide the image on the proposal, or set a proposal-specific image URL (uploaded via
// /api/core/uploads, tenant-scoped). Passing proposalImageUrl:null clears the override (back to catalog image).
const schema = z.object({ hide: z.boolean().optional(), proposalImageUrl: z.string().url().nullable().optional() })
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id, lineId } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await setLineImage(c.tenantId, id, lineId, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : (r.error === 'locked' ? 409 : 400) })
}

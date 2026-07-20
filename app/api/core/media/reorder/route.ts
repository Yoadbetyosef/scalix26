import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { reorderMedia } from '@/lib/core/media'

// POST /api/core/media/reorder { ids: [...] } — persist a new image order (tenant-scoped).
const schema = z.object({ ids: z.array(z.string().uuid()).max(200) })
export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  await reorderMedia(c.tenantId, parsed.data.ids)
  return NextResponse.json({ ok: true })
}

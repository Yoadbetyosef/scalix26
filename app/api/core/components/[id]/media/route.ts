import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { listComponentMedia, addComponentMedia } from '@/lib/core/media'

// GET/POST /api/core/components/[id]/media — a component's image/media gallery. DELETE reuses
// /api/core/media/[id]. Commerce-gated; tenant from the guard.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ media: await listComponentMedia(c.tenantId, (await params).id) })
}

const schema = z.object({ url: z.string().min(1).max(2000), kind: z.enum(['image', 'video', 'file']).optional(), alt: z.string().max(300).nullable().optional() })
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await addComponentMedia(c.tenantId, (await params).id, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

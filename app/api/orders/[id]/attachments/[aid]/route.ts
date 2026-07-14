import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { setAttachmentVisibility, deleteAttachment } from '@/lib/orders/attachments'

const schema = z.object({ visibility: z.enum(['internal', 'public']) })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const ok = await setAttachmentVisibility((await params).aid, parsed.data.visibility)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ok = await deleteAttachment((await params).aid)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

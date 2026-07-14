import { NextRequest, NextResponse } from 'next/server'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { listAttachments, uploadAttachment, signedUrlFor } from '@/lib/orders/attachments'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const items = await listAttachments((await params).id)
  const withUrls = await Promise.all(items.map(async (x) => ({ ...x, url: await signedUrlFor(x.storagePath) })))
  return NextResponse.json({ attachments: withUrls })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  const r = await uploadAttachment((await params).id, file)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'not found' ? 404 : 400 })
  return NextResponse.json({ ok: true, attachment: r.attachment })
}

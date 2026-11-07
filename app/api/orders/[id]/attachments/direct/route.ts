import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { createDirectUpload, completeDirectUpload } from '@/lib/orders/attachments'

// Large files (over the ~4.5 MB a function will accept): the browser uploads straight to storage.
//   POST { fileName, size }               → { path, token, contentType }  — a one-time upload URL
//   PUT  { path, fileName }               → { attachment }                 — register what landed
// See createDirectUpload in lib/orders/attachments.ts.

const start = z.object({ fileName: z.string().min(1).max(300), size: z.number().int().min(0) })
const done = z.object({ path: z.string().min(1).max(400), fileName: z.string().min(1).max(300) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = start.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createDirectUpload((await params).id, parsed.data.fileName, parsed.data.size)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'not found' ? 404 : 400 })
  return NextResponse.json({ path: r.path, token: r.token, contentType: r.contentType })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = done.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await completeDirectUpload((await params).id, parsed.data.path, parsed.data.fileName)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'not found' ? 404 : 400 })
  return NextResponse.json({ ok: true, attachment: r.attachment })
}

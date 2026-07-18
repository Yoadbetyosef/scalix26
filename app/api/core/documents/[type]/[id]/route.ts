import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { getDocument, updateStatus, type DocType } from '@/lib/core/documents'

const TYPES = ['estimate', 'quote', 'invoice'] as const
const parseType = (t: string): DocType | null => (TYPES as readonly string[]).includes(t) ? (t as DocType) : null

export async function GET(_req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { type, id } = await params
  const t = parseType(type); if (!t) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  const doc = await getDocument(c.tenantId, t, id)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(doc)
}

const schema = z.object({ status: z.string().min(1).max(40), note: z.string().max(1000).optional() })
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { type, id } = await params
  const t = parseType(type); if (!t) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const ok = await updateStatus(c.tenantId, t, id, parsed.data.status, c.actor, parsed.data.note)
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 })
}

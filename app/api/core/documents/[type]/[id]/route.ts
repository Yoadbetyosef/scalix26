import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { getDocument, updateStatus, setDocumentCustomer, type DocType } from '@/lib/core/documents'

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

// Update status and/or the attached customer (contact + optional company).
const schema = z.object({
  status: z.string().min(1).max(40).optional(), note: z.string().max(1000).optional(),
  contactId: z.string().uuid().nullable().optional(), companyId: z.string().uuid().nullable().optional(),
})
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { type, id } = await params
  const t = parseType(type); if (!t) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const body = parsed.data
  if (body.status) { const ok = await updateStatus(c.tenantId, t, id, body.status, c.actor, body.note); if (!ok) return NextResponse.json({ ok: false }, { status: 404 }) }
  if ('contactId' in body || 'companyId' in body) {
    const r = await setDocumentCustomer(c.tenantId, t, id, { contactId: body.contactId, companyId: body.companyId })
    if (!r.ok) return NextResponse.json(r, { status: r.error === 'not_found' ? 404 : 400 })
  }
  return NextResponse.json({ ok: true })
}

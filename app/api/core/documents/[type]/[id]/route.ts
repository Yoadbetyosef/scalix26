import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { getDocument, updateStatus, setDocumentCustomer, setDraftNotes, setDraftTax, type DocType } from '@/lib/core/documents'

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
  /** Drafts only — the customer's copy is frozen at issue. */
  notes: z.string().max(10000).nullable().optional(),
  taxable: z.boolean().optional(),
})
const DRAFT_ERR: Record<string, string> = {
  document_not_draft: 'It has already been issued — comments and tax are fixed on the copy the customer has.',
  no_tax_rate: 'There is no sales-tax rate for this business\'s state.',
}
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
  for (const r of [
    'notes' in body ? await setDraftNotes(c.tenantId, t, id, body.notes ?? null) : null,
    body.taxable !== undefined ? await setDraftTax(c.tenantId, t, id, body.taxable) : null,
  ]) {
    if (r && !r.ok) return NextResponse.json({ ok: false, error: DRAFT_ERR[r.error] ?? r.error }, { status: r.error === 'not_found' ? 404 : 409 })
  }
  return NextResponse.json({ ok: true })
}

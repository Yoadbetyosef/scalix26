import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { getProposal, updateProposal } from '@/lib/core/proposals'
import { zodMessage } from '@/lib/core/zod-error'

// GET → full proposal (resolves proposal OR legacy estimate/quote by id). PATCH → autosave header fields.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const doc = await getProposal(c.tenantId, id)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(doc)
}

const schema = z.object({
  title: z.string().max(200).nullable().optional(), scope: z.string().max(25000).nullable().optional(),
  contactId: z.string().uuid().nullable().optional(), companyId: z.string().uuid().nullable().optional(),
  currency: z.string().max(10).optional(), status: z.string().max(40).optional(), salespersonId: z.string().uuid().nullable().optional(),
  expiresAt: z.string().nullable().optional(), customerNotes: z.string().max(25000).nullable().optional(),
  internalNotes: z.string().max(25000).nullable().optional(), terms: z.string().max(25000).nullable().optional(),
  overallDiscountCents: z.number().int().min(0).optional(), taxCents: z.number().int().min(0).optional(),
  template: z.enum(['clean', 'visual', 'minimal']).optional(),
})
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 })
  const r = await updateProposal(c.tenantId, id, parsed.data, c.actor)
  return NextResponse.json(r, { status: r.ok ? 200 : (r.error === 'locked' ? 409 : 400) })
}

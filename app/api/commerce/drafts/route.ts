import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { listDrafts, createDraft } from '@/lib/commerce/drafts'

const schema = z.object({
  name: z.string().max(300).optional(),
  projectId: z.string().uuid().nullable().optional(),
  customerName: z.string().max(300).nullable().optional(),
  customerEmail: z.string().email().max(320).nullable().optional(),
})

export async function GET() {
  const c = await requireCommercePermission('commerce.view')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ drafts: await listDrafts() })
}

export async function POST(req: NextRequest) {
  const c = await requireCommercePermission('commerce.create')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createDraft(parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, draft: r.draft })
}

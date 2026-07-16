import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { getDraft, updateDraftMeta } from '@/lib/commerce/drafts'

const schema = z.object({
  version: z.number().int().nonnegative(),
  patch: z.object({
    name: z.string().max(300).nullable().optional(),
    customer_name: z.string().max(300).nullable().optional(),
    customer_email: z.string().email().max(320).nullable().optional(),
    status: z.string().max(40).optional(),
    internal_notes: z.string().max(5000).nullable().optional(),
    customer_notes: z.string().max(5000).nullable().optional(),
    discount_cents: z.number().int().nonnegative().optional(),
    tax_cents: z.number().int().nonnegative().optional(),
    delivery_cents: z.number().int().nonnegative().optional(),
    additional_cents: z.number().int().nonnegative().optional(),
    expiration_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }).default({}),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCommercePermission('commerce.view')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const d = await getDraft((await params).id)
  if (!d) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(d)
}

// Version-checked autosave. Returns 409 on a version conflict so the client reloads (§18).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCommercePermission('commerce.edit')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await updateDraftMeta((await params).id, parsed.data.version, parsed.data.patch)
  if (r.conflict) return NextResponse.json({ error: 'version_conflict', message: 'This draft was changed elsewhere. Reload to continue.' }, { status: 409 })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, version: r.version })
}

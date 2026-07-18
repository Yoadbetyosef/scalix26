import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { updateDefinition, addOption } from '@/lib/core/config'

// Update a field definition (label/required/order/active). PATCH with { addOption } appends a dropdown value.
const schema = z.object({
  label: z.string().max(200).optional(), required: z.boolean().optional(), sortOrder: z.number().int().optional(), active: z.boolean().optional(),
  addOption: z.object({ value: z.string().min(1).max(200), label: z.string().min(1).max(200) }).optional(),
})
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const id = (await params).id
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { addOption: opt, ...patch } = parsed.data
  if (opt) { const r = await addOption(c.tenantId, id, opt.value, opt.label); if (!r.ok) return NextResponse.json(r, { status: 400 }) }
  if (Object.keys(patch).length) { const r = await updateDefinition(c.tenantId, id, patch); if (!r.ok) return NextResponse.json(r, { status: 404 }) }
  return NextResponse.json({ ok: true })
}

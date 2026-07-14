import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { saveCost, deleteCost } from '@/lib/command-center/cost-store'

// Founder-only actual-cost writes. Self-guarded (404 first), zod-validated, audited.
const schema = z.object({
  id: z.string().uuid().nullable().optional(),
  costType: z.enum(['cogs', 'opex']).optional(),
  category: z.string().max(80).optional(),
  vendor: z.string().max(120).nullable().optional(),
  amountCents: z.number().int().min(0).optional(),
  recurrence: z.enum(['one_time', 'monthly', 'annual']).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  owner: z.string().max(120).nullable().optional(),
})

export async function PATCH(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const { id, ...patch } = parsed.data
  if (!id && (!patch.costType || !patch.category)) return NextResponse.json({ error: 'costType and category required to create' }, { status: 400 })
  const cost = await saveCost(id ?? null, patch, f.email)
  return NextResponse.json({ ok: true, cost })
}

export async function DELETE(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const b = await req.json().catch(() => ({}))
  if (!b.id || typeof b.id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 })
  await deleteCost(b.id, f.email)
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { saveOperatingPlan, deleteOperatingPlan } from '@/lib/command-center/operating-plan-store'

// Founder-only Operating Plan writes. Self-guarded (404 first), zod-validated, audited.
const schema = z.object({
  id: z.string().uuid().nullable().optional(),
  level: z.enum(['annual', 'quarterly', 'monthly', 'weekly', 'daily']).optional(),
  objective: z.string().max(400).optional(),
  metricKey: z.string().max(80).nullable().optional(),
  baseline: z.number().nullable().optional(),
  target: z.number().nullable().optional(),
  owner: z.string().max(120).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(['not_started', 'on_track', 'at_risk', 'off_track', 'done']).optional(),
  progress: z.number().min(0).max(1).optional(),
  notes: z.string().max(2000).nullable().optional(),
  dependencies: z.string().max(1000).nullable().optional(),
  growthEngine: z.enum(['direct', 'affiliate', 'whiteLabel', 'expansion']).nullable().optional(),
  playbook: z.string().max(120).nullable().optional(),
  confidence: z.string().max(40).nullable().optional(),
})

export async function PATCH(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const { id, ...patch } = parsed.data
  if (!id && (!patch.level || !patch.objective)) return NextResponse.json({ error: 'level and objective are required to create' }, { status: 400 })
  const after = await saveOperatingPlan(id ?? null, patch, f.email)
  return NextResponse.json({ ok: true, plan: after })
}

export async function DELETE(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const b = await req.json().catch(() => ({}))
  if (!b.id || typeof b.id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 })
  await deleteOperatingPlan(b.id, f.email)
  return NextResponse.json({ ok: true })
}

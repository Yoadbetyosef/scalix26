import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { acceptGap, saveTask } from '@/lib/command-center/war-room-store'

// Founder-only War Room writes. POST {action:'accept_gap', gap} persists a live gap; PATCH saves/updates a
// task (status/owner/actual/dismiss). Self-guarded (404 first), zod-validated, audited.
const gapSchema = z.object({
  gapKey: z.string().max(120), scope: z.enum(['today', 'week', 'month']), title: z.string().max(300), category: z.string().max(80),
  priority: z.enum(['low', 'medium', 'high', 'critical']), requiredResult: z.number().nullable(), expectedImpactCents: z.number().nullable(), playbook: z.string().max(120).nullable(),
})
const taskSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  scope: z.enum(['today', 'week', 'month']).optional(), title: z.string().max(300).optional(), category: z.string().max(80).optional(),
  requiredResult: z.number().nullable().optional(), actual: z.number().nullable().optional(), owner: z.string().max(120).nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  expectedImpactCents: z.number().nullable().optional(), playbook: z.string().max(120).nullable().optional(),
  status: z.enum(['open', 'in_progress', 'done', 'dismissed']).optional(), dismissReason: z.string().max(500).nullable().optional(),
})

export async function POST(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const b = await req.json().catch(() => ({}))
  if (b.action !== 'accept_gap') return NextResponse.json({ error: 'action=accept_gap required' }, { status: 400 })
  const parsed = gapSchema.safeParse(b.gap)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid gap', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const status = ['open', 'in_progress', 'done', 'dismissed'].includes(b.status) ? b.status : 'open'
  try {
    const task = await acceptGap(parsed.data, f.email, status, typeof b.dismissReason === 'string' ? b.dismissReason : null)
    return NextResponse.json({ ok: true, task })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }) }
}

export async function PATCH(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const parsed = taskSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const { id, ...patch } = parsed.data
  if (!id && (!patch.title || !patch.scope)) return NextResponse.json({ error: 'title and scope required to create' }, { status: 400 })
  const task = await saveTask(id ?? null, { ...patch, source: id ? undefined : 'manual' }, f.email)
  return NextResponse.json({ ok: true, task })
}

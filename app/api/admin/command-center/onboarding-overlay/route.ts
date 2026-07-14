import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { saveOverlay, clearOverlay, BLOCKERS } from '@/lib/command-center/onboarding-overlay'

// Founder-only onboarding-overlay writes. Self-guarded (404 before ANY work), zod-validated, audited by the
// store. No customer message/conversation content is accepted or stored — operational metadata only.
const patchSchema = z.object({
  tenantId: z.string().uuid(),
  owner: z.string().max(120).nullable().optional(),
  manualStage: z.string().max(120).nullable().optional(),
  blocker: z.enum(BLOCKERS).nullable().optional(),
  blockerNotes: z.string().max(1000).nullable().optional(),
  slaDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
  nextAction: z.string().max(1000).nullable().optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.string().max(120).nullable().optional(),
  resolutionNote: z.string().max(1000).nullable().optional(),
})

export async function PATCH(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const { tenantId, ...patch } = parsed.data
  const after = await saveOverlay(tenantId, patch, f.email)
  return NextResponse.json({ ok: true, overlay: after })
}

export async function DELETE(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const b = await req.json().catch(() => ({}))
  if (!b.tenantId || typeof b.tenantId !== 'string') return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
  await clearOverlay(b.tenantId, f.email)
  return NextResponse.json({ ok: true })
}

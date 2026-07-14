import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { saveSupportOverlay, clearSupportOverlay } from '@/lib/command-center/support-store'
import { ISSUE_TYPES, SEVERITIES } from '@/lib/command-center/support-ops'

// Founder-only support-overlay writes. Self-guarded (404 before ANY work), zod-validated, audited by the
// store. Operational metadata only — no conversation/message content is accepted or stored.
const patchSchema = z.object({
  signalId: z.string().min(1).max(200),
  owner: z.string().max(120).nullable().optional(),
  issueType: z.enum(ISSUE_TYPES).nullable().optional(),
  severity: z.enum(SEVERITIES).nullable().optional(),
  status: z.string().max(120).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  resolutionNote: z.string().max(1000).nullable().optional(),
})

export async function PATCH(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const { signalId, ...patch } = parsed.data
  const after = await saveSupportOverlay(signalId, patch, f.email)
  return NextResponse.json({ ok: true, overlay: after })
}

export async function DELETE(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood
  const b = await req.json().catch(() => ({}))
  if (!b.signalId || typeof b.signalId !== 'string') return NextResponse.json({ error: 'signalId required' }, { status: 400 })
  await clearSupportOverlay(b.signalId, f.email)
  return NextResponse.json({ ok: true })
}

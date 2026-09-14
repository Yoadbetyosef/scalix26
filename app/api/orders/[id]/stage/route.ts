import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { setStageManual } from '@/lib/orders/store'
import { ORDER_STAGES } from '@/lib/orders/stages'

// Manual stage change (Kanban drag / explicit set). Approval stages are rejected here by the state machine —
// those transitions only happen through the workflow actions (send-for-approval / respond / send-to-production).
// `note` is the optional reason for the move, kept on the timeline row beside from/to/who.
const schema = z.object({ toStage: z.enum(ORDER_STAGES), note: z.string().max(500).nullable().optional() })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const r = await setStageManual((await params).id, parsed.data.toStage, parsed.data.note ?? null)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'not found' ? 404 : 400 })
  return NextResponse.json({ ok: true })
}

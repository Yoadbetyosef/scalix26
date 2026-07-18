import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { getContactTimeline, addActivity } from '@/lib/core/activities'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ activities: await getContactTimeline(c.tenantId, (await params).id) })
}

// Add a manual note/activity to a contact's timeline.
const schema = z.object({ type: z.enum(['note', 'call', 'email', 'sms']).default('note'), title: z.string().max(300).nullable().optional(), body: z.string().max(10000).nullable().optional() })
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const activity = await addActivity(c.tenantId, { contactId: (await params).id, type: parsed.data.type, title: parsed.data.title ?? null, body: parsed.data.body ?? null, actor: c.actor })
  return NextResponse.json({ activity })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { mergeContacts } from '@/lib/core/merge'

// Merge loserId INTO this contact (the winner). Atomic + idempotent (see core_merge_contacts RPC).
const schema = z.object({ loserId: z.string().uuid() })
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await mergeContacts(c.tenantId, (await params).id, parsed.data.loserId, c.actor)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

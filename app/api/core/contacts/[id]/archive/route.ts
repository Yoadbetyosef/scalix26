import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { archiveContact } from '@/lib/core/contacts'

const schema = z.object({ archived: z.boolean().default(true) })
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  const ok = await archiveContact(c.tenantId, (await params).id, c.actor, parsed.success ? parsed.data.archived : true)
  return NextResponse.json({ ok })
}

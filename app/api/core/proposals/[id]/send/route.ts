import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { sendProposal } from '@/lib/core/proposals'

// Send the branded proposal email + activate the secure public page. Never fires automatically.
const schema = z.object({ recipientEmail: z.string().email() })
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'A valid recipient email is required.' }, { status: 400 })
  const r = await sendProposal(c.tenantId, c.actor, id, { recipientEmail: parsed.data.recipientEmail, baseUrl: req.nextUrl.origin })
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}

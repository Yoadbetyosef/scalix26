import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { sendProposal } from '@/lib/core/proposals'

// Send the branded proposal email + activate the secure public page. Never fires automatically. Provider
// success is the ONLY thing that flips the proposal to "sent".
const schema = z.object({
  recipientEmail: z.string().email(),
  recipientName: z.string().max(200).nullable().optional(),
  cc: z.string().max(320).nullable().optional(),
  subject: z.string().max(300).nullable().optional(),
  message: z.string().max(5000).nullable().optional(),
})
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'A valid recipient email is required.' }, { status: 400 })
  const cc = parsed.data.cc?.trim()
  if (cc && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cc)) return NextResponse.json({ error: 'CC must be a valid email address.' }, { status: 400 })
  const r = await sendProposal(c.tenantId, c.actor, id, { ...parsed.data, baseUrl: req.nextUrl.origin })
  return NextResponse.json(r, { status: r.ok ? 200 : (r.error === 'locked' ? 409 : 400) })
}

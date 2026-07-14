import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { enforce } from '@/lib/ratelimit'
import { createAndSendApproval, listApprovalsForOrder } from '@/lib/orders/approvals'

const schema = z.object({
  approvalType: z.enum(['factory', 'customer']),
  recipientName: z.string().max(200).nullable().optional(),
  recipientEmail: z.string().email().max(320),
  subject: z.string().max(300).nullable().optional(),
  message: z.string().max(3000).nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  attachmentIds: z.array(z.string().uuid()).max(50).optional(),
  sendCopyToSelf: z.boolean().optional(),
  internalNote: z.string().max(3000).nullable().optional(),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ approvals: await listApprovalsForOrder((await params).id) })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const flood = await enforce('command_center', `orders:${a.tenantId}`)
  if (flood) return flood
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const origin = req.nextUrl.origin // the deployment origin → correct public approval link
  const r = await createAndSendApproval((await params).id, parsed.data, origin)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'not found' ? 404 : 400 })
  return NextResponse.json({ ok: true })
}

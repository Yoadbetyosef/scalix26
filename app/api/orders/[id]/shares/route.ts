import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { requestBaseUrl } from '@/lib/request-url'
import { isOrderDocType } from '@/lib/orders/documents'
import { createShareLink, listShares } from '@/lib/orders/shares'

// GET  /api/orders/[id]/shares — every document link ever minted for this order.
// POST /api/orders/[id]/shares — mint a link WITHOUT emailing it, for the owner to send herself.
//
// Raw tokens are NOT returned by GET and cannot be: only their SHA-256 is stored. POST returns the
// one it just minted, once. The list exists so the owner can see which links are live and withdraw
// one, which is the only thing that ends a link.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ shares: await listShares((await params).id) })
}

const schema = z.object({
  docType: z.string().refine(isOrderDocType, 'Unknown document type'),
  label: z.string().max(200).nullable().optional(),
}).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  const r = await createShareLink((await params).id, parsed.data.docType, requestBaseUrl(req), parsed.data.label ?? null)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, url: r.url })
}

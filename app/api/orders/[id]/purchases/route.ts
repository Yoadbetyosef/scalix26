import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { PURCHASE_KINDS, PURCHASE_STATUSES, createPurchase, listPurchases } from '@/lib/orders/purchases'

// GET/POST /api/orders/[id]/purchases — what was bought from suppliers to make this piece.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
export const purchaseSchema = z.object({
  supplierId: z.string().uuid().nullable().optional(), supplierName: z.string().max(200).nullable().optional(),
  kind: z.enum(PURCHASE_KINDS).optional(), description: z.string().min(1).max(300),
  quantity: z.number().int().min(1).max(10000).optional(), costCents: z.number().int().min(0).nullable().optional(), currency: z.string().max(8).optional(),
  reference: z.string().max(120).nullable().optional(), status: z.enum(PURCHASE_STATUSES).optional(),
  orderedOn: date, expectedOn: date, receivedOn: date, qcNote: z.string().max(500).nullable().optional(),
  invoiceAttachmentId: z.string().uuid().nullable().optional(), notes: z.string().max(2000).nullable().optional(),
}).strict()

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(await listPurchases((await params).id))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = purchaseSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const r = await createPurchase((await params).id, parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, purchase: r.purchase })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { getOrder, updateOrder, deleteOrder } from '@/lib/orders/store'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const lineItem = z.object({
  productName: z.string().min(1).max(300), description: z.string().max(2000).nullable().optional(), sku: z.string().max(100).nullable().optional(),
  quantity: z.number().min(0).max(100000).optional(), unitPriceCents: z.number().int().min(0).optional(),
  measurements: z.string().max(500).nullable().optional(), color: z.string().max(200).nullable().optional(), material: z.string().max(200).nullable().optional(),
  customSpec: z.string().max(2000).nullable().optional(), productRef: z.string().uuid().nullable().optional(),
})
const patchSchema = z.object({
  orderNumber: z.string().trim().min(1).max(50).optional(),
  contactId: z.string().uuid().nullable().optional(),
  customerName: z.string().max(300).nullable().optional(), customerEmail: z.string().email().max(320).nullable().optional(), customerPhone: z.string().max(50).nullable().optional(),
  factoryName: z.string().max(300).nullable().optional(), factoryContactName: z.string().max(300).nullable().optional(), factoryEmail: z.string().email().max(320).nullable().optional(),
  assignedEmployee: z.string().max(300).nullable().optional(), orderDate: date.nullable().optional(), requestedCompletionDate: date.nullable().optional(), estimatedCompletionDate: date.nullable().optional(),
  depositCents: z.number().int().min(0).optional(), currency: z.string().max(8).optional(), internalNotes: z.string().max(5000).nullable().optional(), publicNotes: z.string().max(5000).nullable().optional(),
  lineItems: z.array(lineItem).max(200).optional(),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const order = await getOrder((await params).id)
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ order })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  try {
    const order = await updateOrder((await params).id, parsed.data)
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true, order })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Failed to save' }, { status: 400 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ok = await deleteOrder((await params).id)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

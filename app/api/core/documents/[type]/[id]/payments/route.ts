import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { applyPayment, getPaymentSummary } from '@/lib/core/payments'
import type { DocType } from '@/lib/core/documents'

const TYPES = ['estimate', 'quote', 'invoice'] as const
const isType = (t: string): t is DocType => (TYPES as readonly string[]).includes(t)

export async function GET(_req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { type, id } = await params
  if (!isType(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  return NextResponse.json(await getPaymentSummary(c.tenantId, type, id))
}

const schema = z.object({ kind: z.enum(['charge', 'deposit', 'refund', 'adjustment']), amountCents: z.number().int(), currency: z.string().max(10).optional(), providerRef: z.string().max(200).nullable().optional(), idempotencyKey: z.string().max(200).nullable().optional() })
export async function POST(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { type, id } = await params
  if (!isType(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await applyPayment(c.tenantId, type, id, parsed.data, c.actor)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
